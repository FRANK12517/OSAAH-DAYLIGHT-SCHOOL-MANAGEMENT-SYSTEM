/**
 * Balance projection for obligations. Historical payments currently link to
 * invoices, not fee_obligations, so attribution is intentionally unavailable.
 */
export function createFeeObligationBalances() {
  return {
    getBalanceForObligation(obligation) {
      return { obligationId: obligation?.id, allocation_status: 'UNAVAILABLE', charged_minor: Number.isInteger(obligation?.amountMinor) ? obligation.amountMinor : null, paid_minor: null, outstanding_minor: null, payment_status: null };
    },
    getBalancesForObligations(obligations = []) { return obligations.map((obligation) => this.getBalanceForObligation(obligation)); }
  };
}
