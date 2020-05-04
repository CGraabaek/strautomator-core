// Strautomator Core: PayPal Subscriptions

import {PayPalBillingPlan, PayPalSubscription} from "./types"
import api from "./api"
import _ = require("lodash")
import logger = require("anyhow")
import moment = require("moment")
const settings = require("setmeup").settings

/**
 * PayPal Subscriptions API.
 */
export class PayPalSubscriptions {
    private constructor() {}
    private static _instance: PayPalSubscriptions
    static get Instance() {
        return this._instance || (this._instance = new this())
    }

    // BILLING PLAN METHODS
    // --------------------------------------------------------------------------

    /**
     * Return billing plans registered on PayPal.
     * @param productId Optional product ID.
     * @param activeOnly Set to true to return all billing plans instead of only active ones.
     */
    getBillingPlans = async (productId?: string, returnAll?: boolean): Promise<PayPalBillingPlan[]> => {
        try {
            const plans: PayPalBillingPlan[] = []
            const options: any = {
                url: "billing/plans",
                params: {
                    page: 1,
                    page_size: 20
                }
            }

            if (productId) {
                options.params.product_id = productId
            } else {
                productId = null
            }

            const res = await api.makeRequest(options)

            // No plans returned from PayPal? Stop here.
            if (!res.plans || res.plans.length == 0) {
                logger.warn("PayPal.getBillingPlans", `Product ${productId}`, "No billing plans returned from PayPal")
                return []
            }

            // Iterate response and get plan details.
            for (let p of res.plans) {
                if (returnAll || p.status == "ACTIVE") {
                    plans.push(await this.getBillingPlan(p.id))
                }
            }

            // Log parameters.
            const logProduct = productId ? " for product ${productId}" : ""
            const logStatus = returnAll ? "all" : "active only"
            logger.info("PayPal.getBillingPlans", `Status: ${logStatus}`, `Got ${plans.length} plans${logProduct}`)

            return plans
        } catch (ex) {
            logger.error("PayPal.getBillingPlans", `Could not fetch billing plans for product ${productId}`)
            throw ex
        }
    }

    /**
     * Return full details about a single billing plan.
     * @param id The billing plan ID.
     */
    getBillingPlan = async (id: string): Promise<PayPalBillingPlan> => {
        try {
            const options: any = {
                url: `billing/plans/${id}`,
                returnRepresentation: true
            }

            const res = await api.makeRequest(options)

            // No data returned from PayPal? Stop here.
            if (!res.id) {
                logger.warn("PayPal.getBillingPlan", id, "No plan details returned from PayPal")
                return null
            }

            const billingPlan: PayPalBillingPlan = {
                id: res.id,
                productId: res.product_id,
                name: res.name,
                dateCreated: moment(res.create_time).toDate(),
                price: parseFloat(res.billing_cycles[0].pricing_scheme.fixed_price.value),
                frequency: res.billing_cycles[0].frequency.interval_unit.toLowerCase(),
                enabled: false
            }

            // Plan is enabled only if matching the current product ID and with a valid frequency.
            if (settings.plans.pro.price[billingPlan.frequency] && api.currentProduct && api.currentProduct.id == billingPlan.productId) {
                billingPlan.enabled = true
            }

            return billingPlan
        } catch (ex) {
            logger.error("PayPal.getBillingPlan", `Could not fetch billing plans for product ${id}`)
            throw ex
        }
    }

    /**
     * Create a new billing plan on PayPal. Returns the created billing plan object.
     * @param productId The corresponding product ID.
     * @param frequency The billing frequency (by default, month or year).
     */
    createBillingPlan = async (productId: string, frequency: string): Promise<PayPalBillingPlan> => {
        const price = settings.plans.pro.price[frequency].toFixed(2)
        const planName = `${settings.paypal.billingPlan.name} (${price} / ${frequency})`

        try {
            const options = {
                url: "billing/plans",
                method: "POST",
                returnRepresentation: true,
                data: {
                    product_id: productId,
                    name: planName,
                    description: settings.paypal.billingPlan.description,
                    status: "ACTIVE",
                    billing_cycles: [
                        {
                            frequency: {
                                interval_unit: frequency.toUpperCase(),
                                interval_count: 1
                            },
                            tenure_type: "REGULAR",
                            sequence: 1,
                            total_cycles: 0,
                            pricing_scheme: {
                                fixed_price: {
                                    value: price,
                                    currency_code: settings.paypal.billingPlan.currency
                                }
                            }
                        }
                    ],
                    payment_preferences: {
                        auto_bill_outstanding: true,
                        payment_failure_threshold: 2
                    }
                }
            }

            const res = await api.makeRequest(options)

            // Make sure response has a valid ID.
            if (!res || !res.id) {
                throw new Error("Invalid response from PayPal")
            }

            logger.info("PayPal.createBillingPlan", `Product ${productId}, ${price} / ${frequency}`, `New billing plan ID: ${res.id}`)

            // Return the created plan.
            return {
                id: res.id,
                productId: productId,
                name: res.name,
                dateCreated: moment(res.create_time).toDate(),
                price: price,
                frequency: frequency,
                enabled: true
            }
        } catch (ex) {
            logger.error("PayPal.createBillingPlan", `Could not create billing plans for product ${productId}, ${price} / ${frequency}`)
            throw ex
        }
    }

    /**
     * Deactivate the specified billing plan.
     * @param id The corresponding billing plan ID.
     * @param frequency The billing frequency (by default, month or year).
     */
    deactivateBillingPlan = async (id: string): Promise<void> => {
        try {
            const options = {
                url: `billing/plans/${id}/deactivate`,
                method: "POST"
            }

            await api.makeRequest(options)

            // Remove plan from cache of current billing plans.
            if (api.currentBillingPlans) {
                delete api.currentBillingPlans[id]
            }

            logger.info("PayPal.deactivateBillingPlan", id, "Deactivated")
        } catch (ex) {
            logger.error("PayPal.deactivateBillingPlan", id, ex)
            throw ex
        }
    }

    // SUBSCRIPTION METHODS
    // --------------------------------------------------------------------------

    /**
     * Get subsccription details from PayPal.
     * @param id The corresponding subscription ID.
     */
    getSubscription = async (id: string): Promise<PayPalSubscription> => {
        try {
            const options = {
                url: `billing/subscriptions/${id}`,
                returnRepresentation: true
            }

            const res = await api.makeRequest(options)

            // No data returned from PayPal? Stop here.
            if (!res.id) {
                throw new Error(`No data returned from PayPal`)
            }

            // Create subscription object with the fetched details.
            const subscription: PayPalSubscription = {
                id: res.id,
                email: res.subscriber.email_address,
                status: res.status,
                billingPlan: api.currentBillingPlans[res.plan_id],
                dateCreated: moment(res.create_time).toDate(),
                dateUpdated: moment(res.update_time).toDate(),
                dateNextPayment: moment(res.billing_info.next_billing_time).toDate()
            }

            // A payment was already made? Fill last payment details.
            if (res.billing_info.last_payment) {
                subscription.lastPayment = {
                    amount: parseFloat(res.billing_info.last_payment.amount.value),
                    currency: res.billing_info.last_payment.currency_code,
                    date: moment(res.billing_info.last_payment.time).toDate()
                }
            }

            return subscription
        } catch (ex) {
            logger.error("PayPal.getSubscription", `Could not fetch details for subscription ${id}`)
            throw ex
        }
    }

    /**
     * Create a new subscription agreement for the specified billing plan.
     * @param billingPlan The billing plan chosen by the user.
     */
    createSubscription = async (billingPlan: PayPalBillingPlan): Promise<PayPalSubscription> => {
        try {
            const options = {
                url: "billing/subscriptions",
                method: "POST",
                returnRepresentation: true,
                data: {
                    plan_id: billingPlan.id,
                    start_date: moment(new Date()).add(settings.paypal.billingPlan.startMinutes, "minute").format("gggg-MM-DDTHH:mm:ss") + "Z",
                    application_context: {
                        brand_name: settings.app.title,
                        return_url: `${settings.app.url}billing/success`,
                        cancel_url: `${settings.app.url}billing`,
                        shipping_preference: "NO_SHIPPING",
                        payment_method: {
                            payer_selected: "PAYPAL",
                            payee_preferred: "IMMEDIATE_PAYMENT_REQUIRED"
                        }
                    }
                }
            }

            const res = await api.makeRequest(options)

            // Make sure response has a valid ID.
            if (!res || !res.id) {
                throw new Error("Invalid response from PayPal")
            }

            // Get approval URL.
            const approvalUrl = _.find(res.links, {rel: "approve"})

            return {
                id: res.id,
                status: res.status,
                billingPlan: billingPlan,
                dateCreated: moment(res.create_time).toDate(),
                dateUpdated: moment(res.create_time).toDate(),
                approvalUrl: approvalUrl
            }
        } catch (ex) {
            logger.error("PayPal.createBillingAgreement", `Could not create billing agreement for plan ${billingPlan.id}`)
            throw ex
        }
    }
}

// Exports...
export default PayPalSubscriptions.Instance