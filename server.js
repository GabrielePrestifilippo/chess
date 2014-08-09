var express = require('express');
var http = require('http');

var dustjs = require('adaro');
var Room = require('./Room');

//express set-up
var app = express();
app.engine('dust', dustjs.dust({cache: false}));
app.set('view engine', 'dust');
app.use(express.static(__dirname + '/public'));

//global room dictionary
var rooms = {};

//route that displays a game room with a given id.
//If the room doesn't exist, a new room is created and assigned to the id;
app.get('/chess/:id', function (req, res) {
    var id = req.param("id");
    var room = rooms[id];
    if (!room) {
        room = rooms[id] = new Room();
        console.log('new room created with id ' + id);
    }
    console.log(room);
    res.render('room', {roomid: id, room: room, white: false, black: false});
});

//starts the server and socket.io
var server = http.createServer(app).listen(3000);
console.log("listening on port 3000");
var io = require('socket.io')(server);

//listens for connections
io.on('connection', function (socket) {
    console.log('client connected to url ' + socket.request.url);

    //obtains the room for the request url
    var urlMatches = /gameRoom=(\w+)/.exec(socket.request.url);
    if (!urlMatches) {
        console.log("unspecified room");
        socket.emit('error', 'unspecified room');
        return;
    }
    var gameRoomId = urlMatches[1];
    console.log("gameRoomId:" + gameRoomId);

    //joins the client into the room
    socket.join(gameRoomId);
    console.log('socket connected to room: ' + gameRoomId);

    //grabs a reference to the room (it must already exist)
    var room = rooms[gameRoomId];
    if (!room) {
        console.log("room doesn't exist");
        //io.to(socket.id).emit('error', "room doesn't exist");
        return;
    }

    //handles chat
    socket.on('chatmessage', function (msg) {
        socket.to(gameRoomId).emit('chatmessage', msg);
    });

    //handles game updates
    socket.on('fen', function (msg) {
        console.log('fen ', msg, ' from ', socket.id);
        console.log(room.users);

        //if user is a registerd one
        if (room.users.white && room.users.black) {// sennò crasha in quanto non esistono gli attributi socketId

            if (socket.id == room.users.white.socketId || socket.id == room.users.black.socketId) { //ho aggiunto .socketId perchè è l'attributo dell'oggetto che ci interessa
                io.to(gameRoomId).emit('fen', msg);
                io.log("never enter");
            } else {
                console.log("enter always here");
                io.to(socket.id).emit('error', 'not a registered player');
            }
        }
    });

    //handles disconnection
    socket.on('disconnect', function () {
        room.setDisconnected(socket.id);
        console.log('user disconnected');
        io.to(gameRoomId).emit('users', room.userStatuses());
    });

    //registers a user as a player
    socket.on('registerAs', function (color, secret) {
        //if there's already a registered and connected user
        var existingUser = room.users[color];
        if (existingUser && existingUser.connected) {
            io.to(socket.id).emit("error", "specified user is already connected");
            io.to(gameRoomId).emit('users', room.userStatuses());
            return ;
        }

        //if the position is free or user is disconnected
        //register the user
        var user = room.register(color, socket.id, secret); //idempotent
        if (!user) { //wrong secret?
            io.to(socket.id).emit("error", "registration failed");
            io.to(gameRoomId).emit('users', room.userStatuses());
            return;
        }
        
        //tell the user he's been approved
        io.to(socket.id).emit("approved", {color: color, room: gameRoomId, secret: user.secret});

        //emit the new player list to everyone in the room
        io.to(gameRoomId).emit('users', room.userStatuses());

        console.log('player registered', {color: color, room: gameRoomId, secret: user.secret});
    });


    socket.on('error', function (error) {
        console.error('error on socket.io server:', error);
    });

});//io connection