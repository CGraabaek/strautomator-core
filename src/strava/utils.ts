// Strautomator Core: Strava Utils

import {StravaActivity, StravaClub, StravaClubEvent, StravaGear, StravaProfile, StravaRoute, StravaSport} from "./types"
import {UserData} from "../users/types"
import {recipePropertyList} from "../recipes/lists"
import dayjs from "../dayjs"
import _ = require("lodash")
import {StravaProfileStats, StravaTotals} from "src"

// Feet and miles ratio.
const rFeet = 3.28084
const rMiles = 0.621371

/**
 * Helper to transform data from the API to a StravaActivity interface.
 * @param user The activity owner.
 * @param data Input data.
 */
export function toStravaActivity(user: UserData, data: any): StravaActivity {
    const profile = user.profile
    const startDate = dayjs.utc(data.start_date)

    const activity: StravaActivity = {
        id: data.id,
        type: data.type,
        name: data.name,
        description: data.description,
        commute: data.commute ? true : false,
        hideHome: data.hide_from_home ? true : false,
        trainer: data.trainer ? true : false,
        dateStart: startDate.toDate(),
        utcStartOffset: data.utc_offset,
        totalTime: data.elapsed_time,
        movingTime: data.moving_time,
        locationStart: data.start_latlng,
        locationEnd: data.end_latlng,
        hasPower: data.device_watts ? true : false,
        wattsAvg: data.average_watts ? Math.round(data.average_watts) : null,
        wattsWeighted: data.weighted_average_watts ? Math.round(data.weighted_average_watts) : null,
        wattsMax: data.max_watts ? Math.round(data.max_watts) : null,
        hrAvg: data.average_heartrate ? Math.round(data.average_heartrate) : null,
        hrMax: data.max_heartrate ? Math.round(data.max_heartrate) : null,
        cadenceAvg: data.average_cadence || null,
        calories: data.calories || data.kilojoules || null,
        relativeEffort: data.suffer_score || null,
        device: data.device_name,
        manual: data.manual,
        hasPhotos: data.photos && data.photos.count > 0 ? true : false,
        updatedFields: []
    }

    // Activity has location data?
    activity.hasLocation = (activity.locationStart && activity.locationStart.length > 0) || (activity.locationEnd && activity.locationEnd.length > 0)

    // Extra optional fields.
    if (data.workout_type && data.workout_type != 0 && data.workout_type != 10) {
        activity.workoutType = data.workout_type
    }
    if (data.private_note) {
        activity.privateNote = data.private_note
    }
    if (data.perceived_exertion) {
        activity.perceivedExertion = data.perceived_exertion
    }

    // Strava returns offset in seconds, but we store in minutes.
    if (activity.utcStartOffset) {
        activity.utcStartOffset = activity.utcStartOffset / 60
    }

    // Set end date.
    if (data.elapsed_time) {
        activity.dateEnd = startDate.add(data.elapsed_time, "s").toDate()
    }

    // Set activity gear.
    const gearId = data.gear && data.gear.id ? data.gear.id : data.gear_id
    if (gearId) {
        activity.gear = activity.gear = _.find(profile.bikes, {id: gearId}) || _.find(profile.shoes, {id: gearId})
    } else if (data.gear) {
        activity.gear = toStravaGear(profile, data.gear.id)
    }

    // Set polyline.
    if (data.map) {
        activity.polyline = data.map.polyline
    }

    // Default climbing ratio multiplier in metric is 19m / 1km.
    let cRatioMultiplier = 19

    // Convert values according to the specified units.
    if (profile.units == "imperial") {
        // Imperial climbing ration multiplier is 100ft / 1mi
        cRatioMultiplier = 100

        if (data.total_elevation_gain) {
            activity.elevationGain = Math.round(data.total_elevation_gain * rFeet)
        }
        if (data.elev_high) {
            activity.elevationMax = Math.round(data.elev_high * rFeet)
        }
        if (data.distance) {
            activity.distance = parseFloat(((data.distance / 1000) * rMiles).toFixed(1))
        }
        if (data.average_speed) {
            activity.speedAvg = parseFloat((data.average_speed * 3.6 * rMiles).toFixed(1))
        }
        if (data.max_speed) {
            activity.speedMax = parseFloat((data.max_speed * 3.6 * rMiles).toFixed(1))
        }
    } else {
        if (data.total_elevation_gain) {
            activity.elevationGain = data.total_elevation_gain
        }
        if (data.elev_high) {
            activity.elevationMax = data.elev_high
        }
        if (data.distance) {
            activity.distance = parseFloat((data.distance / 1000).toFixed(1))
        }
        if (data.average_speed) {
            activity.speedAvg = parseFloat((data.average_speed * 3.6).toFixed(1))
        }
        if (data.max_speed) {
            activity.speedMax = parseFloat((data.max_speed * 3.6).toFixed(1))
        }
    }

    // Get device temperature if available, using the correct weather unit.
    if (_.isNumber(data.average_temp)) {
        if (user.preferences && user.preferences.weatherUnit == "f") {
            activity.temperature = Math.round((data.average_temp / 5) * 9 + 32)
        } else {
            activity.temperature = Math.round(data.average_temp)
        }
    }

    // Calculate climbing ratio with 2 decimal places.
    if (activity.distance && activity.elevationGain) {
        const climbingRatio = activity.elevationGain / (activity.distance * cRatioMultiplier)
        activity.climbingRatio = Math.round(climbingRatio * 100) / 100
    }

    // Get activity emoticon.
    activity.icon = getSportIcon(activity)

    return activity
}

/**
 * Helper to transform data from the API to a StravaGear interface.
 * @param data Input data.
 */
export function toStravaGear(profile: StravaProfile, data: any): StravaGear {
    const gear: StravaGear = {
        id: data.id,
        name: data.name || data.description,
        primary: data.primary,
        distance: data.distance / 1000
    }

    // Has brand and model?
    if (data.brand_name) {
        gear.brand = data.brand_name
    }
    if (data.model_name) {
        gear.model = data.model_name
    }

    // User using imperial units? Convert to miles.
    if (profile.units == "imperial" && gear.distance > 0) {
        const miles = 0.621371
        gear.distance = gear.distance * miles
    }

    // Round distance.
    gear.distance = Math.round(gear.distance)

    return gear
}

/**
 * Helper to transform data from the API to a StravaProfile interface.
 * @param data Input data.
 */
export function toStravaProfile(data: any): StravaProfile {
    const profile: StravaProfile = {
        id: data.id.toString(),
        username: data.username,
        firstName: data.firstname,
        lastName: data.lastname,
        city: data.city || null,
        country: data.country || null,
        dateCreated: dayjs.utc(data.created_at).toDate(),
        dateUpdated: dayjs.utc(data.updated_at).toDate(),
        units: data.measurement_preference == "feet" ? "imperial" : "metric",
        ftp: data.ftp || null,
        bikes: [],
        shoes: []
    }

    // Has bikes?
    if (data.bikes && data.bikes.length > 0) {
        for (let bike of data.bikes) {
            profile.bikes.push(toStravaGear(profile, bike))
        }
    }

    // Has shoes?
    if (data.shoes && data.shoes.length > 0) {
        for (let shoes of data.shoes) {
            profile.shoes.push(toStravaGear(profile, shoes))
        }
    }

    // Has profile image?
    if (data.profile) {
        profile.urlAvatar = data.profile

        // Relative avatar URL? Append Strava's base URL.
        if (profile.urlAvatar.indexOf("://") < 0) {
            profile.urlAvatar = `/images/avatar.png`
        }
    }

    return profile
}

/**
 * Helper to transform data from the API to a StravaProfileStats interface.
 * @param user The profile owner.
 * @param data Input data.
 */
export function toStravaProfileStats(user: UserData, data: any): StravaProfileStats {
    const stats: StravaProfileStats = {}
    const recentRideTotals = toStravaTotals(user, data.recent_ride_totals)
    const recentRunTotals = toStravaTotals(user, data.recent_run_totals)
    const recentSwimTotals = toStravaTotals(user, data.recent_swim_totals)
    const allRideTotals = toStravaTotals(user, data.all_ride_totals)
    const allRunTotals = toStravaTotals(user, data.all_run_totals)
    const allSwimTotals = toStravaTotals(user, data.all_swim_totals)

    // Append only totals with an actual value.
    if (recentRideTotals) stats.recentRideTotals = recentRideTotals
    if (recentRunTotals) stats.recentRideTotals = recentRunTotals
    if (recentSwimTotals) stats.recentRideTotals = recentSwimTotals
    if (allRideTotals) stats.recentRideTotals = allRideTotals
    if (allRunTotals) stats.recentRideTotals = allRunTotals
    if (allSwimTotals) stats.recentRideTotals = allSwimTotals

    // Convert values according to the specified units.
    if (user.profile.units == "imperial") {
        if (data.distance) {
            stats.biggestRideDistance = parseFloat(((data.biggest_ride_distance / 1000) * rMiles).toFixed(1))
        }
        if (data.elevation_gain) {
            stats.biggestRideClimb = Math.round(data.biggest_climb_elevation_gain * rFeet)
        }
    } else {
        if (data.distance) {
            stats.biggestRideDistance = parseFloat((data.biggest_ride_distance / 1000).toFixed(1))
        }
        if (data.elevation_gain) {
            stats.biggestRideClimb = data.biggest_climb_elevation_gain
        }
    }

    return stats
}
/**
 * Helper to transform data from the API to a StravaTotals interface.
 * @param user The activities owner.
 * @param data Input data.
 */
export function toStravaTotals(user: UserData, data: any): StravaTotals {
    if (data.count < 1) {
        return null
    }

    const totals: StravaTotals = {
        count: data.count,
        totalTime: data.elapsed_time,
        movingTime: data.moving_time
    }

    if (data.data.achievement_count > 0) {
        totals.achievements = data.achievement_count
    }

    // Convert values according to the specified units.
    if (user.profile.units == "imperial") {
        if (data.distance) {
            totals.distance = parseFloat(((data.distance / 1000) * rMiles).toFixed(1))
        }
        if (data.elevation_gain) {
            totals.elevationGain = Math.round(data.total_elevation_gain * rFeet)
        }
    } else {
        if (data.distance) {
            totals.distance = parseFloat((data.distance / 1000).toFixed(1))
        }
        if (data.elevation_gain) {
            totals.elevationGain = data.elevation_gain
        }
    }

    return totals
}

/**
 * Helper to transform data from the API to a StravaClub interface.
 * @param data Input data.
 */
export function toStravaClub(data: any): StravaClub {
    const club: StravaClub = {
        id: data.id.toString(),
        name: data.name,
        url: data.url,
        sport: data.sport_type,
        type: data.club_type,
        photo: data.cover_photo,
        city: data.city,
        country: data.country,
        memberCount: data.member_count,
        private: data.private
    }

    return club
}

/**
 * Helper to transform data from the API to a StravaClubEvent interface.
 * @param data Input data.
 */
export function toStravaClubEvent(data: any): StravaClubEvent {
    const clubEvent: StravaClubEvent = {
        id: data.id,
        title: data.title,
        description: data.description,
        type: data.activity_type,
        dates: [],
        joined: data.joined,
        private: data.private,
        womenOnly: data.women_only,
        address: data.address
    }

    if (data.organizing_athlete) {
        clubEvent.organizer = toStravaProfile(data.organizing_athlete)
    }

    if (data.upcoming_occurrences && data.upcoming_occurrences.length > 0) {
        clubEvent.dates = data.upcoming_occurrences.map((d) => dayjs(d).toDate())
    }

    // Club event has a route defined? Set the base route ID, which can then be used
    // to fetch the full route details.
    if (data.route && data.route.id_str) {
        clubEvent.route = {id: data.route.id_str}
    }

    return clubEvent
}

/**
 * Helper to transform data from the API to a StravaRoute interface.
 * @param data Input data.
 */
export function toStravaRoute(user: UserData, data: any): StravaRoute {
    const multDistance = user.profile.units == "imperial" ? 0.621371 : 1
    const multFeet = user.profile.units == "imperial" ? 3.28084 : 1
    const distance = parseFloat(((data.distance / 1000) * multDistance).toFixed(1))
    const elevationGain = Math.round(data.elevation_gain * multFeet)

    const route: StravaRoute = {
        id: data.id,
        name: data.name,
        description: data.description,
        type: data.type == 1 ? StravaSport.Ride : StravaSport.Run,
        distance: distance,
        elevationGain: elevationGain
    }

    if (data.estimated_moving_time) {
        route.estimatedTime = data.estimated_moving_time
    }

    return route
}

/**
 * Return activity icon (emoji) based on its type.
 * @param source The relevant Strava activity or club event.
 */
export function getSportIcon(source: StravaActivity | StravaClubEvent): string {
    switch (source.type) {
        case "Run":
        case "VirtualRun":
            return "🏃"
        case "Walk":
            return "🚶"
        case "Ride":
        case "EBikeRide":
        case "VirtualRide":
            return "🚲"
        case "Swim":
            return "🏊"
        case "AlpineSki":
        case "BackcountrySki":
        case "NordicSki":
            return "⛷"
        case "Snowboard":
            return "🏂"
        case "IceSkate":
        case "Snowshoe":
            return "⛸"
        case "Skateboard":
            return "🛹"
        case "RockClimbing":
            return "🧗"
        case "Surfing":
        case "Windsurf":
            return "🏄"
        case "Canoeing":
            return "🛶"
        case "Rowing":
            return "🚣"
        case "Sail":
            return "⛵"
        case "Golf":
            return "🏌"
        case "Soccer":
            return "⚽"
        case "Crossfit":
        case "Elliptical":
        case "WeightTraining":
            return "🏋"
        case "Yoga":
            return "🧘"
        case "Wheelchair":
            return "🧑‍🦽"
        default:
            return "👤"
    }
}

/**
 * Process the activity and add the necessary suffixes to its fields.
 * @param user The user owning the activity.
 * @param activity The Strava activity to be transformed.
 */
export const transformActivityFields = (user: UserData, activity: StravaActivity): void => {
    for (let prop of recipePropertyList) {
        let suffix = user.profile.units == "imperial" && prop.impSuffix ? prop.impSuffix : prop.suffix

        // Farenheit temperature suffix (special case).
        if (prop.fSuffix && user.preferences && user.preferences.weatherUnit == "f") {
            suffix = prop.fSuffix
        }

        // Make sure times are set using the format "HH:MM".
        if (prop.type == "time") {
            if (_.isNumber(activity[prop.value])) {
                const aDuration = dayjs.duration(activity[prop.value], "seconds")
                activity[prop.value] = aDuration.format("HH:mm")
            } else if (_.isDate(activity[prop.value])) {
                const aDate = dayjs.utc(activity[prop.value]).add(activity.utcStartOffset, "minutes")
                const format = prop.value.substring(0, 4) == "date" ? "L HH:mm" : "HH:mm"
                activity[prop.value] = aDate.format(format)
            }
        }

        // Append suffixes.
        if (suffix && !_.isNil(activity[prop.value]) && !_.isDate(activity[prop.value])) {
            activity[prop.value] = `${activity[prop.value]}${suffix}`
        }
    }

    // Replace gear object with the gear name.
    if (activity.gear && activity.gear.name) {
        activity.gear = activity.gear.name as any
    }
}
