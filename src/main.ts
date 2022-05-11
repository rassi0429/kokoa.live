import express from "express"

const app = express()

import httpServer from "http"

const hs = httpServer.createServer(app)
import {Server} from "socket.io"
import {spawn} from "child_process";

const io = new Server(hs, {maxHttpBufferSize: 1e10})

spawn('ffmpeg', ['-h']).on('error', function (m) {
    console.error("FFMpeg not found in system cli; please install ffmpeg properly or make a softlink to ./!");
    process.exit(-1);
})

app.use(express.static('static'));

app.get("/", (req, res) => {
    res.send("hoho")
})

io.on("connection", (socket) => {
    let rtmp = ""
    let codec = ""
    let ffmpeg_process: any = false
    let feedStream: any = false

    socket.emit("message", "Hi")

    socket.on("setRtmp", (data) => {
        if (typeof data != 'string') {
            socket.emit('message', 'rtmp destination setup error.');
            return;
        }
        // var regexValidator = /^rtmp:\/\/[^\s]*$/;//TODO: should read config
        // if (!regexValidator.test(data)) {
        //     socket.emit('message', 'rtmp address rejected.');
        //     return;
        // }
        rtmp = "rtsp://localhost:8554/live/" + data;
        socket.emit('message', 'rtmp destination set to:' + data);
    })
    socket.on("start", (data) => {
        if (ffmpeg_process || feedStream) {
            socket.emit('fatal', 'stream already started.');
            return;
        }
        if (!rtmp) {
            socket.emit('fatal', 'no destination given.');
            return;
        }

        const framerate = Number(socket.handshake.query.framespersecond);
        const audioBitrate = parseInt(socket.handshake.query.audioBitrate + "");
        let audioEncoding = "64k";
        if (audioBitrate == 11025) {
            audioEncoding = "11k";
        } else if (audioBitrate == 22050) {
            audioEncoding = "22k";
        } else if (audioBitrate == 44100) {
            audioEncoding = "44k";
        }
        console.log(audioEncoding, audioBitrate);
        console.log('framerate on node side', framerate);
        let ops: string[] = [];
        if (framerate == 1) {
            ops = [
                '-i', '-',
                '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
                //'-max_muxing_queue_size', '1000',
                //'-bufsize', '5000',
                '-r', '1', '-g', '2', '-keyint_min', '2',
                '-x264opts', 'keyint=2', '-crf', '25', '-pix_fmt', 'yuv420p',
                '-profile:v', 'baseline', '-level', '3',
                '-c:a', 'aac', '-b:a', audioEncoding, '-ar', audioBitrate + "",
                '-f', 'rtsp', '-rtsp_transport', 'tcp', rtmp
            ];

        } else {
            ops = [
                '-i', '-',
                '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
                '-max_muxing_queue_size', '1000',
                '-bufsize', '5000',
                '-r', framerate.toString(), '-g', '30', '-keyint_min', '30',
                '-x264opts', 'keyint=30', '-crf', '25', '-pix_fmt', 'yuv420p',
                '-profile:v', 'baseline', '-level', '3',
                '-c:a', 'aac', '-b:a', audioEncoding, '-ar', audioBitrate + "",
                '-f', 'rtsp', '-rtsp_transport', 'tcp', rtmp
            ];
            //
            // } else {
            //     ops = [
            //         '-i', '-',
            //         //'-c', 'copy',
            //         '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',  // video codec config: low latency, adaptive bitrate
            //         '-c:a', 'aac', '-ar', audioBitrate + "", '-b:a', audioEncoding, // audio codec config: sampling frequency (11025, 22050, 44100), bitrate 64 kbits
            //         "-r", framerate.toString(),
            //         //'-max_muxing_queue_size', '4000',
            //         //'-y', //force to overwrite
            //         //'-use_wallclock_as_timestamps', '1', // used for audio sync
            //         //'-async', '1', // used for audio sync
            //         //'-filter_complex', 'aresample=44100', // resample audio to 44100Hz, needed if input is not 44100
            //         //'-strict', 'experimental',
            //         '-bufsize', '5000',
            //
            //         '-f', 'flv', rtmp
            //         /*. original params
            //         '-i','-',
            //         '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',  // video codec config: low latency, adaptive bitrate
            //         '-c:a', 'aac', '-ar', '44100', '-b:a', '64k', // audio codec config: sampling frequency (11025, 22050, 44100), bitrate 64 kbits
            //         '-y', //force to overwrite
            //         '-use_wallclock_as_timestamps', '1', // used for audio sync
            //         '-async', '1', // used for audio sync
            //         //'-filter_complex', 'aresample=44100', // resample audio to 44100Hz, needed if input is not 44100
            //         //'-strict', 'experimental',
            //         '-bufsize', '1000',
            //         '-f', 'flv', socket._rtmpDestination
            //         */
            //
            //     ];
        }
        console.log("ops", ops);
        console.log(rtmp);
        ffmpeg_process = spawn('ffmpeg', ops);
        console.log("ffmpeg spawned");
        feedStream = function (w: any) {
            ffmpeg_process.stdin.write(w);
            //write exception cannot be caught here.
        }

        ffmpeg_process.stderr.on('data', function (d: any) {
            console.log(d.toString())
            socket.emit('ffmpeg_stderr', '' + d);
        });
        ffmpeg_process.stdout.on('data', function (d: any) {
            console.log(d.toString())
        });
        ffmpeg_process.on('error', function (e: any) {
            console.log('child process error' + e);
            socket.emit('fatal', 'ffmpeg error!' + e);
            feedStream = false;
            socket.disconnect();
        });
        ffmpeg_process.on('exit', function (e: any) {
            console.log('child process exit' + e);
            socket.emit('fatal', 'ffmpeg exit!' + e);
            socket.disconnect();
        });
    })
    socket.on("stream", (data) => {
        try {
            if (!feedStream) {
                socket.emit('fatal', 'rtmp not set yet.');
                ffmpeg_process.stdin.end();
                ffmpeg_process.kill('SIGINT');
                return;
            }
            feedStream(data);
        } catch {
        }
    })
    socket.on("disconnect", (data) => {
        console.log("socket disconnected!");
        feedStream = false;
        if (ffmpeg_process)
            try {
                ffmpeg_process.stdin.end();
                ffmpeg_process.kill('SIGINT');
                console.log("ffmpeg process ended!");
            } catch (e) {
                console.warn('killing ffmoeg process attempt failed...');
            }
    })


    socket.on('error', function (e) {

        console.log('socket.io error:' + e);
    });

    socket.on("getRTMP", (data) => {
        socket.emit('message', rtmp);
    })
})


hs.listen(3000, () => {
    console.log("OK")
})