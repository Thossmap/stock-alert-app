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

function isMarketOpen() {
    const now = new Date()

    // Convert to US Eastern Time
    const est = new Date(
        now.toLocaleString("en-US", { timeZone: "America/New_York" })
    )

    const day = est.getDay()
    const hour = est.getHours()
    const minute = est.getMinutes()

    // Weekday check (Mon-Fri)
    if (day === 0 || day === 6) return false

    // Time between 9:30 and 16:00 ET
    const afterOpen = (hour > 9 || (hour === 9 && minute >= 30))
    const beforeClose = (hour < 16)

    return afterOpen && beforeClose
}

async function checkPrices() {
    const alerts = loadAlerts()

    // Get unique symbols that still need checking
    const symbols = [...new Set(
        alerts
            .filter(a => !a.triggered)
            .map(a => a.symbol)
    )]

    for (let symbol of symbols) {
    try {
        const response = await axios.get(
            "https://finnhub.io/api/v1/quote",
            {
                params: {
                    symbol: symbol,
                    token: process.env.FINNHUB_KEY
                }
            }
        )

        const price = response.data.c

        // Finnhub returns 0 or null if there's an issue
        if (!price || price === 0) {
            console.log("Finnhub error or empty response:", response.data)
            continue
        }

        console.log(`${symbol} current price: ${price}`)

            for (let alert of alerts) {
                if (alert.symbol !== symbol || alert.triggered) continue

                if ((alert.high && price >= alert.high) ||
                    (alert.low && price <= alert.low)) {

                    await sgMail.send({
                        to: process.env.ALERT_EMAIL,
                        from: process.env.ALERT_EMAIL,
                        subject: `Stock Alert: ${symbol}`,
                        text: `${symbol} triggered at ${price}`
                    })

                    alert.triggered = true
                    console.log(`${symbol} alert triggered at ${price}`)
                }
            }

        } catch (err) {
            console.log(`Error checking ${symbol}:`, err.message)
        }
    }

    saveAlerts(alerts)
}

// Run 4 times per trading hours
cron.schedule('0 15,17,19,20 * * 1-5', checkPrices)

app.listen(3000, () => console.log("Server running"))
