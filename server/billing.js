// Stripe billing: Checkout for new subscriptions, the customer portal for
// changes, and webhooks as the single source of truth for a user's plan.
import Stripe from 'stripe'
import { PAID_PLANS, lookupKey, planFromLookupKey } from './plans.js'

export const STRIPE_API_VERSION = '2026-10-28.endive'
const CHECKOUT_LABEL = 'geo_optimizer_subscription_qhzvkmtw'
const ENTITLED = ['active', 'trialing', 'past_due'] // past_due keeps access while Stripe retries the payment

export const WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
  'charge.refunded',
  'charge.dispute.created',
  'radar.early_fraud_warning.created',
]

export function createStripeClient(secretKey) {
  return secretKey ? new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION, maxNetworkRetries: 2 }) : null
}

const idOf = (value) => (typeof value === 'string' ? value : value?.id || null)

export function createBilling({ stripe, store, appUrl, webhookSecret }) {
  const enabled = Boolean(stripe)

  async function ensureCustomer(user, profile) {
    if (profile?.stripe_customer_id) return profile.stripe_customer_id
    const customer = await stripe.customers.create({ email: user.email, name: profile?.name || undefined, metadata: { app: 'geo-optimizer-ai', user_id: user.id } })
    await store.setBilling(user.id, { stripe_customer_id: customer.id })
    return customer.id
  }

  async function activeSubscription(customerId) {
    const list = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 20 })
    const ours = list.data.filter((subscription) => subscription.items.data.some((item) => planFromLookupKey(item.price?.lookup_key)))
    return ours.find((subscription) => ENTITLED.includes(subscription.status)) || null
  }

  // Reads the customer's current subscription from Stripe and writes the
  // resulting plan. Idempotent and independent of event ordering.
  async function syncCustomer(customerId, extra = {}) {
    if (!customerId) return null
    const profile = await store.getProfileByCustomer(customerId)
    if (!profile) return null
    const subscription = await activeSubscription(customerId)
    const item = subscription?.items.data.find((entry) => planFromLookupKey(entry.price?.lookup_key))
    const plan = subscription ? planFromLookupKey(item.price.lookup_key) : 'free'
    return store.setBilling(profile.id, {
      plan,
      stripe_subscription_id: subscription?.id || null,
      subscription_status: subscription?.status || 'none',
      ...extra,
    })
  }

  async function customerOfCharge(chargeRef) {
    const chargeId = idOf(chargeRef)
    if (!chargeId) return null
    const charge = typeof chargeRef === 'object' && chargeRef.customer !== undefined ? chargeRef : await stripe.charges.retrieve(chargeId)
    return idOf(charge.customer)
  }

  return {
    enabled,
    webhookConfigured: Boolean(webhookSecret),

    async createCheckout(user, profile, plan, interval) {
      if (!PAID_PLANS.includes(plan)) throw new Error('Unknown plan')
      const customerId = await ensureCustomer(user, profile)
      if (await activeSubscription(customerId)) return { url: (await this.createPortal(user, { ...profile, stripe_customer_id: customerId })).url, portal: true }
      const key = lookupKey(plan, interval)
      const prices = await stripe.prices.list({ lookup_keys: [key], active: true, limit: 1 })
      if (!prices.data.length) throw new Error(`Stripe price ${key} is not configured`)
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        client_reference_id: user.id,
        line_items: [{ price: prices.data[0].id, quantity: 1 }],
        allow_promotion_codes: true,
        billing_address_collection: 'auto',
        tax_id_collection: { enabled: true },
        customer_update: { name: 'auto', address: 'auto' },
        integration_identifier: CHECKOUT_LABEL,
        success_url: `${appUrl}/?billing=success`,
        cancel_url: `${appUrl}/?billing=cancelled`,
      })
      return { url: session.url, portal: false }
    },

    async createPortal(user, profile) {
      const customerId = profile?.stripe_customer_id
      if (!customerId) throw new Error('No billing account yet')
      const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: `${appUrl}/?billing=portal` })
      return { url: session.url }
    },

    // Verifies the signature, then applies the event. Returns the handled type.
    async handleWebhook(rawBody, signature) {
      const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
      const object = event.data.object
      switch (event.type) {
        case 'checkout.session.completed':
        case 'checkout.session.async_payment_succeeded':
          // Access is granted from the subscription state, never from an unpaid session.
          if (object.mode === 'subscription' && object.payment_status !== 'unpaid') await syncCustomer(idOf(object.customer), { billing_flag: null })
          break
        case 'checkout.session.async_payment_failed':
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted':
        case 'invoice.paid':
        case 'invoice.payment_failed':
        case 'charge.refunded':
          await syncCustomer(idOf(object.customer))
          break
        case 'charge.dispute.created': {
          const customerId = await customerOfCharge(object.charge)
          console.warn('stripe dispute opened', object.id, customerId)
          await syncCustomer(customerId, { billing_flag: 'suspended' })
          break
        }
        case 'radar.early_fraud_warning.created': {
          const customerId = await customerOfCharge(object.charge)
          console.warn('stripe early fraud warning', object.id, customerId)
          await syncCustomer(customerId, { billing_flag: 'review' })
          break
        }
        default:
          break
      }
      return event.type
    },
  }
}
