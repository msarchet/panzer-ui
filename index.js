const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { spawn } = require('child_process');

const { Server } = require("socket.io");
const io = new Server(server);
const engineOneName = 'stockfish'
const engineTwoName = 'panzer'

const engineOne = spawn(`./engines/${engineOneName}`);
const engineTwo = spawn(`./engines/${engineTwoName}`);
const engineMaster = spawn('./engines/panzer');

let latestWins = 0;
let otherWins = 0;
let draws = 0;
function exitHandler(options, exitCode) {
	if (options.exception) console.log(options.err);
	if (options.signint) console.log('sigint')
	if (options.sigusr1) console.log('sigusr1')
	if (options.sigusr2) console.log('sigusr2')
	console.log('hit exit handler');
	engineOne.kill();
	engineTwo.kill();
	engineMaster.kill();
	process.kill();
}

//do something when app is closing
process.on('exit', exitHandler.bind(null,{cleanup:true}));

//catches ctrl+c event
process.on('SIGINT', exitHandler.bind(null, {signint:true}));

// catches "kill pid" (for example: nodemon restart)
process.on('SIGUSR1', exitHandler.bind(null, {sigusr1:true}));
process.on('SIGUSR2', exitHandler.bind(null, {sigurs2:true}));

//catches uncaught exceptions
process.on('uncaughtException', err =>  exitHandler({exception:true, err: err}));

app.use(express.static('public'))
app.get('/', (req, res) => {  res.sendFile(__dirname + '/index.html');});

let clientSocketId;
let masterStarted = false;

let playingWhite = 1;
let whiteTurn = true;
let gamecount = 0;

let engineOneReady = false;
let engineTwoReady = false;

let engineOneReadySent = false;
let engineTwoReadySent = false;

io.on('connection', socket => {
	clientSocketId = socket.id;
	console.log(clientSocketId);
	socket.on('startgame', _ => {
		if (!engineOneReady && !engineTwoReady)
		{
			socket.emit('status', { message: 'engines not ready'});
			return
		}
		startNewGame();
	})

});

function startNewGame() {
	engineOne.stdin.write('ucinewgame\n');
	engineTwo.stdin.write('ucinewgame\n');

	if (gamecount > 0)
	{
		playingWhite = playingWhite == 1 ? 2 : 1;
	}

	whiteTurn = true;
	io.of("/").emit('names', { 
		white: playingWhite == 1 ? engineOneName : engineTwoName, 
		black: playingWhite == 2 ? engineOneName : engineTwoName }
	)

	io.of("/").emit('scores', { latestWins, otherWins, draws });
	engineMaster.stdin.write('position startpos\n');
	engineMaster.stdin.write('fen\n', err => console.log(err));
	gamecount++;

}


let fen = "";
let parseOutput = (input, engineId) => {

	let lines = input.split(/r?\n/);
	for (let index in lines)
	{
		message = lines[index];

		if (message == "readyok")
		{
			switch(engineId)
			{
				case 1:
					engineOneReady = true;
					engineOne.stdin.write("setoption name Skill Level value 10\n")
					engineOne.stdin.write("setoption name UCI_Elo value 1700\n")
					break;
				case 2:
					engineTwoReady = true;
					engineOne.stdin.write("setoption name Skill Level value 10\n")
					engineOne.stdin.write("setoption name UCI_Elo value 1700\n")
					break;
			}
		}

		if (message.startsWith("bestmove"))
		{
			console.log('got new bestmove');
			// new best move
			let move = message.split(' ')[1];


			engineMaster.stdin.write(`position fen ${fen} moves ${move} \n`);

			io.of("/").emit('update_board', { 
				fen,
				move
			});

			if (move == "checkmate" || move == "draw" || move == "a1a1")
			{
				if (move == "checkmate") {
					let isWin = message.split(' ')[2] == "W";
					if (isWin) 
					{
						latestWins++
					}
					else
					{
						otherWins++
					}
				}
				else
				{
					draws++;
				}

				io.of("/").emit('state', { state: move });
				startNewGame();
				return;
			}

			console.log('sending fen');
			engineMaster.stdin.write("fen\n");
		}

		if (message.startsWith("fen"))
		{
			let index = message.indexOf(' ');
			fen = message.substr(index + 1);
			console.log(`position fen ${fen}`)

			if (whiteTurn)
			{
				// white turn
				if (playingWhite == 1)
				{
					engineOne.stdin.write(`position fen ${fen}\n`);
					engineOne.stdin.write('go depth 6\n');
					whiteTurn = !whiteTurn;
				}
				else
				{
					engineTwo.stdin.write(`position fen ${fen}\n`);
					engineTwo.stdin.write('go depth 6\n');
					whiteTurn = !whiteTurn;
				}
			}
			else
			{
				// black turn 
				if (playingWhite == 1)
				{
					engineTwo.stdin.write(`position fen ${fen}\n`);
					engineTwo.stdin.write('go depth 6\n');
					whiteTurn = !whiteTurn;
				}
				else
				{
					engineOne.stdin.write(`position fen ${fen}\n`);
					engineOne.stdin.write('go depth 6\n');
					whiteTurn = !whiteTurn;
				}
			}
		}
	}
}


engineOne.stdout.on('data', function (data) {
  console.log(engineOneName + data.toString());
  if (!engineOneReady && !engineOneReadySent)
  {
	  engineOneReadySent = true;
	  engineOne.stdin.write('uci\n');
	  engineOne.stdin.write('isready\n');
	  return;
  }
  parseOutput(data.toString(), 1);
});

engineOne.stderr.on('data', function (data) {
  console.log('stderr ' + engineOneName + data.toString());
});

engineOne.on('exit', function (code) {
  console.log(engineOneName + 'process exited with code ' + code.toString());
});

engineTwo.stdout.on('data', function (data) {
  console.log(engineTwoName + data.toString());
  if (!engineTwoReady && !engineTwoReadySent)
  {
	  engineTwoReadySent = true;
	  engineTwo.stdin.write('uci\n');
	  engineTwo.stdin.write('isready\n');
	  return;
  }
  parseOutput(data.toString(), 2);
});

engineTwo.stderr.on('data', function (data) {
  console.log('stderr ' + engineTwoName + data.toString());
});

engineTwo.on('exit', function (code) {
  console.log(engineTwoName + 'process exited with code ' + code.toString());
});

engineMaster.stdout.on('data', data => { 
  console.log('engineMaster: ' + data.toString());
  if (!masterStarted)
  {
	  masterStarted = true;
	  return;
  }

  parseOutput(data.toString())
});



server.listen(process.env.PORT || 3000, () => {  console.log('listening on *:3000');});