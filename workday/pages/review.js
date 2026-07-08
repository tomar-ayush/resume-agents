// Page: review
// No autofill. The user reviews and submits manually. This module exists so
// the loop has a registered handler for the review page (and so we can log
// that we're awaiting the user's submit).

const { logStep } = require('../helpers');

const autofillers = [];

async function autofill() {
  logStep('on_review_awaiting_user_submit');
}

module.exports = { pageType: 'review', autofillers, autofill };
