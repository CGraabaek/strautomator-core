// Strautomator Core: Weather - Storm Glass

import {WeatherApiStats, WeatherProvider, WeatherSummary} from "./types"
import {getSuntimes, processWeatherSummary, weatherSummaryString} from "./utils"
import {UserPreferences} from "../users/types"
import {axiosRequest} from "../axios"
import logger = require("anyhow")
import dayjs from "../dayjs"
const settings = require("setmeup").settings

/**
 * Storm Glass weather API.
 */
export class StormGlass implements WeatherProvider {
    private constructor() {}
    private static _instance: StormGlass
    static get Instance(): StormGlass {
        return this._instance || (this._instance = new this())
    }
    apiRequest = null
    stats: WeatherApiStats = null

    name: string = "stormglass"
    title: string = "Storm Glass"
    hoursPast: number = 168
    hoursFuture: number = 0

    // METHODS
    // --------------------------------------------------------------------------

    /**
     * Get current weather conditions for the specified coordinates and date.
     * @param coordinates Array with latitude and longitude.
     * @param dDate Date for the weather request (as a DayJS object).
     * @param preferences User preferences to get proper weather units.
     */
    getWeather = async (coordinates: [number, number], dDate: dayjs.Dayjs, preferences: UserPreferences): Promise<WeatherSummary> => {
        const unit = preferences && preferences.weatherUnit == "f" ? "imperial" : "metric"
        const isoDate = dDate.toISOString()
        const utcDate = dDate.utc()
        const utcNow = dayjs.utc()
        const diffHours = Math.abs(utcNow.diff(utcDate, "hours"))
        const isFuture = utcNow.isBefore(utcDate)
        const maxHours = isFuture ? this.hoursFuture : this.hoursPast

        try {
            if (diffHours > maxHours) throw new Error(`Date out of range: ${isoDate}`)
            if (!preferences) preferences = {}

            const baseUrl = settings.weather.stormglass.baseUrl
            const secret = settings.weather.stormglass.secret
            const isYesterday = utcDate.dayOfYear() != dayjs.utc().dayOfYear()
            const params = "airTemperature,humidity,pressure,cloudCover,windDirection,windSpeed,precipitation,snowDepth,visibility"
            let weatherUrl = `${baseUrl}weather/point?lat=${coordinates[0]}&lng=${coordinates[1]}&params=${params}`

            // If date is different than today, send it with the request.
            if (isYesterday) weatherUrl += `&start=${utcDate.unix()}&end=${utcDate.add(1, "h").unix()}`

            // Set auth header.
            const headers = {Authorization: secret}

            // Fetch weather data.
            logger.debug("StormGlass.getWeather", weatherUrl)
            const res = await this.apiRequest.schedule(() => axiosRequest({url: weatherUrl, headers: headers}))

            // Parse result.
            const result = this.toWeatherSummary(res, coordinates, dDate, preferences)
            if (result) {
                logger.info("StormGlass.getWeather", weatherSummaryString(coordinates, dDate, result))
            }

            return result
        } catch (ex) {
            logger.error("StormGlass.getWeather", coordinates, isoDate, unit, ex)
            this.stats.errorCount++
            throw ex
        }
    }

    /**
     * Transform data from the Storm Glass API to a WeatherSummary.
     * @param data Data from Storm Glass.
     * @param coordinates Array with latitude and longitude.
     * @param dDate The date (as a DayJS object).
     * @param preferences The user preferences.
     */
    private toWeatherSummary = (data: any, coordinates: [number, number], dDate: dayjs.Dayjs, preferences: UserPreferences): WeatherSummary => {
        if (!data) return

        // Get correct array from response.
        data = data.hours || data.data

        // Locate weather details for the correct time.
        const timeFilter = dDate.utc().format("YYYY-MM-DDTHH")
        const timeData = data.find((r) => r.time.includes(timeFilter))

        // Data for the specified time not found? Stop here.
        if (!timeData) return

        const cloudCover = this.getDataProperty(timeData.cloudCover)
        const precipLevel = this.getDataProperty(timeData.precipitation)
        const snowDepth = this.getDataProperty(timeData.snowDepth)
        const precipitation = snowDepth > 0 && precipLevel > 0 ? "Snow" : null

        const result: WeatherSummary = {
            provider: this.name,
            summary: null,
            temperature: this.getDataProperty(timeData.airTemperature),
            feelsLike: this.getDataProperty(timeData.airTemperature),
            humidity: this.getDataProperty(timeData.humidity),
            pressure: this.getDataProperty(timeData.pressure),
            windSpeed: this.getDataProperty(timeData.windSpeed),
            windDirection: this.getDataProperty(timeData.windDirection),
            precipitation: precipitation,
            cloudCover: cloudCover,
            visibility: this.getDataProperty(timeData.visibility),
            extraData: {
                timeOfDay: getSuntimes(coordinates, dDate).timeOfDay,
                mmPrecipitation: precipLevel
            }
        }

        // Process and return weather summary.
        processWeatherSummary(result, dDate, preferences)
        return result
    }

    /**
     * Helper to get a property value from SG, DWD or NOAA sources.
     * @param data Data to get the property from.
     */
    private getDataProperty = (data: any) => {
        if (!data) return null
        return data.sg || data.dwd || data.noaa
    }
}

// Exports...
export default StormGlass.Instance
