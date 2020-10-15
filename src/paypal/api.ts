// Strautomator Core: PayPal API

import {PayPalAuth, PayPalBillingPlan, PayPalProduct} from "./types"
import {axiosRequest} from "../axios"
import _ = require("lodash")
import logger = require("anyhow")
import moment = require("moment")
import querystring = require("querystring")
const settings = require("setmeup").settings
const packageVersion = require("../../package.json").version

// Helper function to get error details from PayPal responses.
const parseResponseError = (err) => {
    if (!err.response || !err.response.data) return err

    const details = []
    const data = err.response.data

    if (err.response.status) {
        details.push(`Status ${err.response.status}`)
    }

    if (data.name) {
        details.push(data.name)
    } else if (data.message) {
        details.push(data.message)
    }

    if (data.details && data.details.length > 0) {
        for (let d of data.details) {
            const issue = `${d.issue} ${d.description}`.trim()
            details.push(issue)
        }
    }

    if (details.length == 0) {
        details.push(JSON.stringify(err, null, 0))
    }

    return details.join(", ")
}

/**
 * PayPal API handler.
 */
export class PayPalAPI {
    private constructor() {}
    private static _instance: PayPalAPI
    static get Instance() {
        return this._instance || (this._instance = new this())
    }

    /**
     * Authentication token and expiry timestamp.
     */
    auth: PayPalAuth

    /**
     * The current product registered on PayPal.
     */
    currentProduct: PayPalProduct

    /**
     * Active billing plans on PayPal.
     */
    currentBillingPlans: {[id: string]: PayPalBillingPlan}

    /**
     * URL used for webhooks.
     */
    get webhookUrl(): string {
        const baseUrl = settings.api.url || `${settings.app.url}api/`
        const token = settings.paypal.api.urlToken
        return `${baseUrl}paypal/webhook/${token}`
    }

    // METHODS
    // --------------------------------------------------------------------------

    /**
     * Authenticate on PayPal and get a new access token.
     */
    authenticate = async () => {
        try {
            const options = {
                method: "POST",
                url: `${settings.paypal.api.baseUrl}oauth2/token`,
                timeout: settings.oauth.tokenTimeout,
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
                },
                auth: {
                    username: settings.paypal.api.clientId,
                    password: settings.paypal.api.clientSecret
                },
                data: querystring.stringify({grant_type: "client_credentials"})
            }

            // Try fetching a new token from PayPal.
            const res = await axiosRequest(options)
            const expiresIn = res.expires_in ? res.expires_in : 3600

            // Set auth token and expiry timestamp.
            this.auth = {
                accessToken: res.access_token,
                expiresAt: expiresIn + moment().unix() - 120
            }

            logger.info("PayPal.authenticate", "Got a new token")
        } catch (ex) {
            logger.error("PayPal.authenticate", parseResponseError(ex))
        }
    }

    /**
     * Make a request to the PayPal API with the given options.
     * @param options Options passed to the request (axios).
     */
    makeRequest = async (reqOptions: any): Promise<any> => {
        try {
            if (this.auth.expiresAt <= moment().unix()) {
                logger.info("PayPal.makeRequest", reqOptions.url, "Token expired, will fetch a new one")
                await this.authenticate()
            }

            const options = _.cloneDeep(reqOptions)

            // Make sure headers object is set.
            if (!options.headers) options.headers = {}

            // Set correct full URL.
            if (options.url.substring(0, 4) != "http") {
                options.url = `${settings.paypal.api.baseUrl}${options.url}`
            }

            // Append auth header and custom user agent.
            options.headers["Authorization"] = `Bearer ${this.auth.accessToken}`
            options.headers["User-Agent"] = `${settings.app.title} / ${packageVersion}`

            // Return full representation?
            if (options.returnRepresentation) {
                delete options.returnRepresentation
                options.headers["Prefer"] = "return=representation"
            }

            // Dispatch request to PayPal.
            const res = await axiosRequest(options)
            return res
        } catch (ex) {
            const err = parseResponseError(ex)
            logger.error("PayPal.makeRequest", reqOptions.method, reqOptions.url, err)
            ex.message = err
            throw ex
        }
    }
}

// Exports...
export default PayPalAPI.Instance
