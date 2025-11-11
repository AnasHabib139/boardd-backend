const { createActivity } = require("../../../models/activityModel");
const { ACTION_TYPE } = require("../../../utils/constants");
const { findUser } = require("../../../models/userModel");

/**
 * Helper function to format currency amount
 */
function formatAmount(amount, currency = 'usd') {
  const formatted = (amount / 100).toFixed(2);
  const symbols = {
    usd: '$',
    eur: '€',
    gbp: '£'
  };
  const symbol = symbols[currency.toLowerCase()] || currency.toUpperCase();
  return `${symbol}${formatted}`;
}

/**
 * Generic invoice activity creator
 */
exports.createInvoiceActivity = async ({
  type,
  tabId,
  userId,
  invoiceId,
  metadata = {}
}) => {
  // Get user name
  const user = await findUser({ _id: userId });
  const userName = user?.name || 'Someone';

  let message;

  switch (type) {
    case ACTION_TYPE.CREATE_INVOICE:
      {
        const amount = formatAmount(metadata.amount, metadata.currency);
        const itemCount = metadata.lineItemsCount;
        const status = metadata.autoSent ? 'and sent' : 'as draft';
        message = {
          forCreator: `You created an invoice for ${amount} with ${itemCount} line item${itemCount > 1 ? 's' : ''} ${status}`,
          forOthers: `${userName} created an invoice for ${amount} with ${itemCount} line item${itemCount > 1 ? 's' : ''} ${status}`
        };
      }
      break;

    case ACTION_TYPE.UPDATE_INVOICE:
      message = {
        forCreator: 'You updated invoice details',
        forOthers: `${userName} updated invoice details`
      };
      break;

    case ACTION_TYPE.FINALIZE_INVOICE:
      {
        const invoiceNumber = metadata.invoiceNumber || '';
        const amount = formatAmount(metadata.amount, metadata.currency);
        message = {
          forCreator: `You finalized invoice ${invoiceNumber} for ${amount}`,
          forOthers: `${userName} finalized invoice ${invoiceNumber} for ${amount}`
        };
      }
      break;

    case ACTION_TYPE.SEND_INVOICE:
      {
        const invoiceNumber = metadata.invoiceNumber || '';
        const amount = formatAmount(metadata.amount, metadata.currency);
        message = {
          forCreator: `You sent invoice ${invoiceNumber} for ${amount} to client`,
          forOthers: `${userName} sent invoice ${invoiceNumber} for ${amount} to client`
        };
      }
      break;

    case ACTION_TYPE.VOID_INVOICE:
      {
        const invoiceNumber = metadata.invoiceNumber || 'invoice';
        message = {
          forCreator: `You voided ${invoiceNumber}`,
          forOthers: `${userName} voided ${invoiceNumber}`
        };
      }
      break;

    case ACTION_TYPE.DELETE_INVOICE:
      {
        const amount = formatAmount(metadata.amount, metadata.currency);
        message = {
          forCreator: `You deleted a draft invoice for ${amount}`,
          forOthers: `${userName} deleted a draft invoice for ${amount}`
        };
      }
      break;

    case ACTION_TYPE.INVOICE_PAID:
      {
        const invoiceNumber = metadata.invoiceNumber || 'Invoice';
        const amount = formatAmount(metadata.amount, metadata.currency);
        message = {
          forCreator: `${invoiceNumber} was paid - ${amount} received`,
          forOthers: `${invoiceNumber} was paid - ${amount} received`
        };
      }
      break;

    case ACTION_TYPE.INVOICE_PAYMENT_FAILED:
      {
        const invoiceNumber = metadata.invoiceNumber || 'Invoice';
        const attempt = metadata.attemptCount || 1;
        message = {
          forCreator: `Payment failed for ${invoiceNumber} (attempt ${attempt})`,
          forOthers: `Payment failed for ${invoiceNumber} (attempt ${attempt})`
        };
      }
      break;

    case ACTION_TYPE.CREATE_SUBSCRIPTION:
      {
        const amount = formatAmount(metadata.amount, metadata.currency);
        const interval = metadata.interval;
        const intervalCount = metadata.intervalCount || 1;
        const frequency = intervalCount === 1 ? interval : `${intervalCount} ${interval}s`;
        message = {
          forCreator: `You created a recurring subscription for ${amount} every ${frequency}`,
          forOthers: `${userName} created a recurring subscription for ${amount} every ${frequency}`
        };
      }
      break;

    case ACTION_TYPE.UPDATE_SUBSCRIPTION:
      message = {
        forCreator: 'You updated subscription settings',
        forOthers: `${userName} updated subscription settings`
      };
      break;

    case ACTION_TYPE.CANCEL_SUBSCRIPTION:
      {
        const when = metadata.cancelAtPeriodEnd ? 'at period end' : 'immediately';
        message = {
          forCreator: `You canceled the subscription ${when}`,
          forOthers: `${userName} canceled the subscription ${when}`
        };
      }
      break;

    case ACTION_TYPE.PAUSE_SUBSCRIPTION:
      message = {
        forCreator: 'You paused the subscription',
        forOthers: `${userName} paused the subscription`
      };
      break;

    case ACTION_TYPE.RESUME_SUBSCRIPTION:
      message = {
        forCreator: 'You resumed the subscription',
        forOthers: `${userName} resumed the subscription`
      };
      break;

    case ACTION_TYPE.SUBSCRIPTION_RENEWED:
      {
        const amount = formatAmount(metadata.amount, metadata.currency);
        const cycleNumber = metadata.cycleNumber || '';
        message = {
          forCreator: `Subscription automatically renewed - ${amount} charged (cycle ${cycleNumber})`,
          forOthers: `Subscription automatically renewed - ${amount} charged (cycle ${cycleNumber})`
        };
      }
      break;

    default:
      message = {
        forCreator: 'Invoice activity occurred',
        forOthers: `${userName} performed an invoice action`
      };
  }

  return createActivity({
    tabId,
    invoiceId,
    userId,
    actionType: type,
    timestamp: new Date(),
    message,
    metadata
  });
};

/**
 * Create invoice creation activity
 */
exports.createInvoiceCreatedActivity = async ({
  tabId,
  userId,
  invoiceId,
  amount,
  currency,
  lineItemsCount,
  autoSent
}) => {
  return exports.createInvoiceActivity({
    type: ACTION_TYPE.CREATE_INVOICE,
    tabId,
    userId,
    invoiceId,
    metadata: { amount, currency, lineItemsCount, autoSent }
  });
};

/**
 * Create invoice sent activity
 */
exports.createInvoiceSentActivity = async ({
  tabId,
  userId,
  invoiceId,
  invoiceNumber,
  amount,
  currency
}) => {
  return exports.createInvoiceActivity({
    type: ACTION_TYPE.SEND_INVOICE,
    tabId,
    userId,
    invoiceId,
    metadata: { invoiceNumber, amount, currency }
  });
};

/**
 * Create invoice paid activity
 */
exports.createInvoicePaidActivity = async ({
  tabId,
  invoiceId,
  invoiceNumber,
  amount,
  currency
}) => {
  return exports.createInvoiceActivity({
    type: ACTION_TYPE.INVOICE_PAID,
    tabId,
    userId: null, // System event
    invoiceId,
    metadata: { invoiceNumber, amount, currency }
  });
};

/**
 * Create invoice payment failed activity
 */
exports.createInvoicePaymentFailedActivity = async ({
  tabId,
  invoiceId,
  invoiceNumber,
  amount,
  currency,
  attemptCount
}) => {
  return exports.createInvoiceActivity({
    type: ACTION_TYPE.INVOICE_PAYMENT_FAILED,
    tabId,
    userId: null, // System event
    invoiceId,
    metadata: { invoiceNumber, amount, currency, attemptCount }
  });
};

/**
 * Create subscription created activity
 */
exports.createSubscriptionCreatedActivity = async ({
  tabId,
  userId,
  invoiceId,
  amount,
  currency,
  interval,
  intervalCount
}) => {
  return exports.createInvoiceActivity({
    type: ACTION_TYPE.CREATE_SUBSCRIPTION,
    tabId,
    userId,
    invoiceId,
    metadata: { amount, currency, interval, intervalCount }
  });
};

/**
 * Create subscription renewal activity
 */
exports.createSubscriptionRenewedActivity = async ({
  tabId,
  invoiceId,
  amount,
  currency,
  cycleNumber
}) => {
  return exports.createInvoiceActivity({
    type: ACTION_TYPE.SUBSCRIPTION_RENEWED,
    tabId,
    userId: null, // System event
    invoiceId,
    metadata: { amount, currency, cycleNumber }
  });
};
