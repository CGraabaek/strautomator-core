const core = require("./lib/index.js")

const dryRun = async () => {
    await core.startup(false)
    process.exit()
}

dryRun()