require('dotenv').config()
const express = require('express')
const axios = require('axios')
const fs = require('fs')
const cron = require('node-cron')
const sgMail = require('@sendgrid/mail')

const app = express()
app.use(express.json())
app.use(express.static('public'))

sgMail.setApiKey(process.env.SENDGRID_API_KEY)

const ALERTS_FILE = './alerts.json'

function loadAlerts() {
    return JSON.parse(fs.readFileSync(ALERTS_FILE))
}

function saveAlerts(alerts) {
    fs.writeFileSync(ALERTS_FILE, JSON.stringify(alerts, null, 2))
}

app.get('/alerts', (req, res) => {
    res.json(loadAlerts())
})

app.post('/alerts', (req, res) => {
    const alerts = loadAlerts()
    alerts.push({
        id: Date.now(),
        symbol: req.body.symbol.toUpperCase(),
        high: req.body.high,
        low: req.body.low,
        triggered: false
    })
    saveAlerts(alerts)
    res.json({ success: true })
})

app.post('/reset/:id', (req, res) => {
    const alerts = loadAlerts()
    const alert = alerts.find(a => a.id == req.params.id)
    if (alert) alert.triggered = false
    saveAlerts(alerts)
    res.json({ success: true })
})

async function checkPrices() {
    const alerts = loadAlerts()

    for (let alert of alerts) {
        if (alert.triggered) continue

        try {
            const response = await axios.get(
                `https://www.alphavantage.co/query`,
                {
                    params: {
                        function: "GLOBAL_QUOTE",
                        symbol: alert.symbol,
                        apikey: process.env.ALPHA_VANTAGE_KEY
                    }
                }
            )

            const price = parseFloat(response.data["Global Quote"]["05. price"])

            if ((alert.high && price >= alert.high) ||
                (alert.low && price <= alert.low)) {

                await sgMail.send({
                    to: process.env.ALERT_EMAIL,
                    from: process.env.ALERT_EMAIL,
                    subject: `Stock Alert: ${alert.symbol}`,
                    text: `${alert.symbol} triggered at ${price}`
                })

                alert.triggered = true
                console.log(`${alert.symbol} alert triggered`)
            }

        } catch (err) {
            console.log("Error checking:", alert.symbol)
        }
    }

    saveAlerts(alerts)
}

// Run every 10 minutes
cron.schedule('*/10 * * * *', checkPrices)

app.listen(3000, () => console.log("Server running"))
