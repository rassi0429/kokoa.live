const express = require("express")
const app = express()

const httpServer = require("http").createServer(app)
const webSocket = require("ws")
const wss = new webSocket.Server({ server: httpServer })

app.use(express.static('static'));

app.get("/", (req, res) => {
    res.send("hoho")
})



httpServer.listen(3000)