import { $, $$, escapeHtml } from "../js/dom.js";
import { api } from "../js/api.js";
import { isoToday } from "../js/date.js";
import {
    fmtDollarsFromCents,
    fmtDollarsAccountingFromCents,
    parseCentsFromDollarsString,
} from "../js/money.js";
import {
    activeNav,
    card,
    showModal,
    table,
    wireTableFilters,
} from "../js/ui.js";

export async function viewAccounts() {
    activeNav("accounts");
    const { data } = await api("/api/accounts");

    const moneyCell = (cents) => {
        const n = Number(cents ?? 0);
        const cls =
            n < 0 ? "num neg mono" : n > 0 ? "num pos mono" : "num mono";
        return {
            text: fmtDollarsAccountingFromCents(n),
            className: cls,
            title: String(cents ?? ""),
        };
    };

    const rows = data.map((a) => ({
        id: a.id,
        name: a.name,
        opening_date: a.opening_date,
        opening_balance: moneyCell(a.opening_balance_cents),
        type: Number(a.is_liability ?? 0) ? "Liability" : "Asset",
        apr: Number(a.is_interest_bearing ?? 0)
            ? `${(Number(a.interest_apr_bps ?? 0) / 100).toFixed(2)}% ${String(a.interest_compound || "D")}`
            : "",
        dash: Number(a.exclude_from_dashboard ?? 0) ? "hidden" : "",
        archived_at: a.archived_at || "",
    }));

    $("#page").innerHTML = card(
        "Accounts",
        `${rows.length} total`,
        `
          <div class="actions" style="margin-bottom: 10px;">
            <button class="primary" id="a_add">Add account</button>
          </div>
          ${table(
              [
                  "name",
                  "type",
                  "apr",
                  "opening_date",
                  "opening_balance",
                  "dash",
                  "archived_at",
              ],
              rows,
              (r) => `
                <div class="row-actions">
                  <button data-edit-account="${r.id}">Edit</button>
                  <button data-correct-account="${r.id}">Correct</button>
                  <button class="danger" data-del-account="${r.id}">Delete</button>
                </div>
              `,
              {
                  id: "accounts",
                  filter: true,
                  filterPlaceholder: "Filter accounts…",
              },
          )}
        `,
    );

    wireTableFilters($("#page"));

    const byId = new Map(data.map((a) => [a.id, a]));

    const fmtAprPercent = (bps) => {
        const n = Number(bps ?? 0);
        if (!Number.isFinite(n) || n <= 0) return "";
        return (n / 100).toFixed(2);
    };

    const parseAprBps = (s) => {
        const t = String(s || "").trim();
        if (t === "") return null;
        const n = Number(t);
        if (!Number.isFinite(n) || n < 0) return NaN;
        return Math.round(n * 100); // percent -> basis points
    };

    const accountModalHtml = (a) => {
        const isEdit = Boolean(a);
        const isLiability = Number(a?.is_liability ?? 0) ? 1 : 0;
        const isInterest = Number(a?.is_interest_bearing ?? 0) ? 1 : 0;
        const compound = String(a?.interest_compound || "D") || "D";
        const excludeDash = Number(a?.exclude_from_dashboard ?? 0) ? 1 : 0;
        return `
          <div class="grid two">
            <div>
              <label>Name</label>
              <input id="am_name" value="${escapeHtml(a?.name || "")}" placeholder="Account Name" />
            </div>
            <div>
              <label>Opening date</label>
              <input id="am_opening_date" value="${escapeHtml(a?.opening_date || isoToday())}" />
            </div>
            <div>
              <label>Opening balance ($)</label>
              <input id="am_opening_balance" value="${isEdit ? fmtDollarsFromCents(a.opening_balance_cents) : ""}" placeholder="0.00" />
            </div>
            <div>
              <label>Archived at (optional)</label>
              <input id="am_archived_at" value="${escapeHtml(a?.archived_at || "")}" placeholder="YYYY-MM-DD" />
            </div>

            <div>
              <label>Type</label>
              <select id="am_is_liability">
                <option value="0" ${isLiability ? "" : "selected"}>Asset (normal)</option>
                <option value="1" ${isLiability ? "selected" : ""}>Liability (loan/credit)</option>
              </select>
            </div>
            <div>
              <label>Hide on Dashboard</label>
              <select id="am_exclude_dash">
                <option value="0" ${excludeDash ? "" : "selected"}>No</option>
                <option value="1" ${excludeDash ? "selected" : ""}>Yes</option>
              </select>
            </div>

            <div>
              <label>Interest-bearing</label>
              <select id="am_is_interest">
                <option value="0" ${isInterest ? "" : "selected"}>No</option>
                <option value="1" ${isInterest ? "selected" : ""}>Yes</option>
              </select>
            </div>
            <div>
              <label>APR (%)</label>
              <input id="am_apr" value="${escapeHtml(fmtAprPercent(a?.interest_apr_bps))}" placeholder="18.99" />
            </div>
            <div>
              <label>Compounding</label>
              <select id="am_compound">
                <option value="D" ${compound === "D" ? "selected" : ""}>Daily</option>
                <option value="M" ${compound === "M" ? "selected" : ""}>Monthly</option>
              </select>
            </div>

            <div style="grid-column: 1 / -1;">
              <label>Description</label>
              <input id="am_desc" value="${escapeHtml(a?.description || "")}" placeholder="" />
            </div>
          </div>
          <div class="actions" style="margin-top: 10px;">
            <button class="primary" id="am_save">${isEdit ? "Save" : "Create"}</button>
          </div>
        `;
    };

    const showAccountModal = (a) => {
        const isEdit = Boolean(a);
        const { root, close } = showModal({
            title: isEdit ? `Edit account #${a.id}` : "Add account",
            subtitle: "Opening date + opening balance is your starting point.",
            bodyHtml: accountModalHtml(a),
        });

        const modal = root.querySelector(".modal");

        const interestSel = modal.querySelector("#am_is_interest");
        const aprInput = modal.querySelector("#am_apr");
        const compoundSel = modal.querySelector("#am_compound");

        const syncInterestUI = () => {
            const on = Number(interestSel?.value || 0) === 1;
            if (aprInput) aprInput.disabled = !on;
            if (compoundSel) compoundSel.disabled = !on;
        };
        interestSel?.addEventListener("change", syncInterestUI);
        syncInterestUI();

        modal.querySelector("#am_save").onclick = async () => {
            try {
                const opening_balance_cents =
                    parseCentsFromDollarsString(
                        modal.querySelector("#am_opening_balance").value,
                    ) ?? 0;

                const is_interest_bearing = Number(
                    modal.querySelector("#am_is_interest").value || 0,
                )
                    ? 1
                    : 0;
                const aprBps = parseAprBps(
                    modal.querySelector("#am_apr").value,
                );
                if (is_interest_bearing) {
                    if (aprBps === null)
                        throw new Error(
                            "APR is required when Interest-bearing=Yes",
                        );
                    if (!Number.isFinite(aprBps))
                        throw new Error("APR must be a number (e.g., 18.99)");
                }

                const payload = {
                    name: modal.querySelector("#am_name").value,
                    opening_date: modal.querySelector("#am_opening_date").value,
                    opening_balance_cents,
                    description: modal.querySelector("#am_desc").value,
                    archived_at:
                        modal.querySelector("#am_archived_at").value || null,

                    is_liability: Number(
                        modal.querySelector("#am_is_liability").value || 0,
                    )
                        ? 1
                        : 0,
                    is_interest_bearing,
                    interest_apr_bps: is_interest_bearing
                        ? Number(aprBps)
                        : null,
                    interest_compound:
                        modal.querySelector("#am_compound").value || "D",
                    exclude_from_dashboard: Number(
                        modal.querySelector("#am_exclude_dash").value || 0,
                    )
                        ? 1
                        : 0,
                };

                if (isEdit)
                    await api(`/api/accounts/${a.id}`, {
                        method: "PUT",
                        body: JSON.stringify(payload),
                    });
                else
                    await api("/api/accounts", {
                        method: "POST",
                        body: JSON.stringify(payload),
                    });

                close();
                location.hash = "#/accounts";
            } catch (e) {
                alert(e.message);
            }
        };
    };

    const showCorrectBalanceModal = (a) => {
        const { root, close } = showModal({
            title: `Correct Balance: ${a.name}`,
            subtitle:
                "Set the actual balance on a specific date. An adjustment entry will be created.",
            bodyHtml: `
              <div class="grid two">
                <div>
                  <label>Date</label>
                  <input id="cb_date" value="${isoToday()}" />
                </div>
                <div>
                  <label>Correct Balance ($)</label>
                  <input id="cb_balance" placeholder="0.00" />
                </div>
              </div>
              <div class="actions" style="margin-top: 10px;">
                <button class="primary" id="cb_save">Save Correction</button>
              </div>
            `,
        });

        const modal = root.querySelector(".modal");
        modal.querySelector("#cb_save").onclick = async () => {
            try {
                const balanceCents = parseCentsFromDollarsString(
                    modal.querySelector("#cb_balance").value,
                );
                if (balanceCents === null || isNaN(balanceCents))
                    throw new Error("Invalid balance amount");

                const payload = {
                    account_id: a.id,
                    date: modal.querySelector("#cb_date").value,
                    balance_cents: balanceCents,
                };

                await api("/api/accounts/correct-balance", {
                    method: "POST",
                    body: JSON.stringify(payload),
                });

                alert("Correction entry created.");
                close();
            } catch (e) {
                alert(e.message);
            }
        };
    };

    $("#a_add").onclick = () => showAccountModal(null);

    $$("#page [data-del-account]").forEach((btn) => {
        btn.onclick = async () => {
            const id = Number(btn.dataset.delAccount);
            if (
                !confirm(
                    "Delete account? This will fail if referenced by schedules/entries.",
                )
            )
                return;
            try {
                await api(`/api/accounts/${id}`, { method: "DELETE" });
                location.hash = "#/accounts";
            } catch (e) {
                alert(e.message);
            }
        };
    });

    $$("#page [data-edit-account]").forEach((btn) => {
        btn.onclick = () => {
            const id = Number(btn.dataset.editAccount);
            const a = byId.get(id);
            if (!a) return;
            showAccountModal(a);
        };
    });

    $$("#page [data-correct-account]").forEach((btn) => {
        btn.onclick = () => {
            const id = Number(btn.dataset.correctAccount);
            const a = byId.get(id);
            if (!a) return;
            showCorrectBalanceModal(a);
        };
    });
}
