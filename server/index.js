const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
	cors: {
		origin: "*",  // Geliştirme için serbest
	}
});

const rooms = [];

function genCode(len = 4) {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
	let s = '';
	while (s.length < len) s += chars[Math.floor(Math.random() * chars.length)];
	return s;
}

io.on('connection', (socket) => {
	console.log('Bir kullanıcı bağlandı:', socket.id);

	socket.on('sendMessage', msg => {
		const rc = msg.room;
		console.log(rc + " odasına " + msg.username + " tarafından mesaj geldi")
		if (!rc) return;
		io.to(rc).emit('message', msg);
	});

	socket.on('createRoom', user => {
		socket.data.username = user.username;
		const code = genCode();
		const newUser = { id: user.id, sid: socket.id, username: user.username, userRole: "X" }
		rooms.push({
			id: code,
			users: [newUser],
			game: {
				board: Array(9).fill(null),
				moveHistory: [],       // FIFO için
				turn: 'X',
				win: { isWin: false, winner: null, line: null }            // her zaman “X” ile başla
			}
		});
		socket.join(code); // Odayı oluşturan kullanıcıyı kurduğu odaya dahil ettik.
		socket.data.userRoom = code;
		const room = rooms.find(room => room.id == code)
		console.log("Birazdan göndericem, newUser = ")
		console.log(newUser)
		console.log("Birazdan göndericem, room = ")
		console.log(room);

		socket.emit('roomCreated', newUser, room);
		console.log(`🔨 Room ${code} created by ${user.username}`);
	});

	socket.on('joinRoom', ({ user, roomCode }) => {
		socket.data.username = user.username;
		const room = rooms.find(room => room.id == roomCode)
		if (!room) {
			return socket.emit('err', 'Oda bulunamadı.');
		}
		if (room.users.length >= 2) {
			return socket.emit('err', 'Oda dolu.');
		}
		const newUser = { id: user.id, sid: socket.id, username: user.username, userRole: "O" }

		room.users.push(newUser) // Kullanıcıyı room değişkenine ekledik
		socket.join(roomCode); // Kullanıcıyı odaya dahil ettik
		socket.data.userRoom = roomCode;

		socket.emit('roomJoined', newUser, room);
		// diğerine bildir
		io.to(roomCode).emit('someoneJoined', room);


		console.log(`🚪 ${user.username} joined room ${roomCode}`);


		if (room.users.length === 2) {
			io.to(room.id).emit('gameStart', { turn: 'X' });
		}
	});


	socket.on('makeMove', ({ index, roomCode }) => {
		const room = rooms.find(r => r.id === roomCode);
		if (!room || !room.game) return;

		const me = room.users.find(u => u.sid === socket.id);
		if (!me || me.userRole !== room.game.turn) return;  // senin sıran değil

		// 1) FIFO board güncellemesi
		if (room.game.moveHistory.length >= 9) {
			const oldest = room.game.moveHistory.shift();
			room.game.board[oldest.index] = null;
		}
		console.log(index + " e tıklandı")

		// 2) Yeni hamleyi kaydet
		room.game.moveHistory.push({ index, symbol: me.userRole });
		console.log(room.game.moveHistory)
		room.game.board[index] = me.userRole;

		if (room.game.moveHistory.length >= 7) {
			console.log("sinigidislfkdkşfl")
			const oldest = room.game.moveHistory.shift();
			room.game.board[oldest.index] = null;
		}



		let tahta = room.game.board;
		console.log("======== STATUS ===========");

		console.log(tahta[0] + " " + tahta[1] + " " + tahta[2])
		console.log(tahta[3] + " " + tahta[4] + " " + tahta[5])
		console.log(tahta[6] + " " + tahta[7] + " " + tahta[8])
		// 4) Sırayı değiştir
		room.game.turn = room.game.turn === 'X' ? 'O' : 'X';

		// 5) Durumu yay
		io.to(roomCode).emit('boardUpdate', room.game);


		// 3) Kazanma kontrolü
		const result = checkWinAtMove(room.game.board, index, 3);
		if (result) {
			// Kazanan var: tüm odadakilere gameOver bildir
			winnerUser = room.users.find(usr => usr.userRole == result.player);
			io.to(roomCode).emit('gameOver', {
				board: room.game.board,
				turn: room.game.turn,
				history: room.game.moveHistory,
				win: { isWin: true, winner: winnerUser, line: result.line }
			});
			// Oyun bitince istersen room.game’i null’a çekebilir veya sadece 
			// kazanmadan sonra hamle kabul etmeyebilirsiniz.
			return;
		}


	});






	socket.on('disconnect', (reason) => {
		console.log(`❌ Disconnect tetiklendi! socket.id=${socket.id}`, 'Sebep:', reason);
		console.log('Socket.username:', socket.data.username, " odası : " + socket.data.userRoom);
		if (socket.data.username) {
			const roomCode = socket.data.userRoom;
			if (!roomCode) { console.log("oda kodu yok aga noluyo"); return; };
			const idx = rooms.findIndex(room => room.id == socket.data.userRoom)
			if (idx == -1) { console.log("aga odayı bulamıyom"); return; };

			const room = rooms[idx];
			room.users = room.users.filter(u => u.username !== socket.data.username)

			if (room.users.length === 0) {
				rooms.splice(idx, 1);
			} else {
				io.to(socket.data.userRoom).emit('someoneLeaved', room);
				console.log(`${socket.data.username} ayrılıyor, broadcast yapıyorum.`);
				socket.broadcast.emit('userLogout', { username: socket.data.username });
			}
		}
	});
});

server.listen(3000, () => {
	console.log('Sunucu 3000 portunda çalışıyor.');
});

/**
 * Son hamlenin konumuna göre tahtada K kadar yatay/dikey/çapraz aynı sembol var mı bakar.
 *
 * @param {'X'|'O'|null} board[]   - 9 elemanlı 1D dizi, index 0…8
 * @param {number} idx             - Son hamlenin index'i (0…8)
 * @param {number} K               - Kaç aynı sembol olunca kazanırız (3 için klasik XOX)
 * @returns {{ player: 'X'|'O', line: number[] } | null}
 */
function checkWinAtMove(board, idx, K = 3) {
	const N = 3;                       // 3×3 tahta
	const player = board[idx];        // 'X' veya 'O'
	if (!player) return null;

	// idx → satır r, sütun c
	const r = Math.floor(idx / N);
	const c = idx % N;

	// 4 ana yön (dr, dc)
	const directions = [
		[0, 1],   // yatay
		[1, 0],   // dikey
		[1, 1],   // çapraz ↘
		[1, -1],  // çapraz ↙
	];

	for (let [dr, dc] of directions) {
		let count = 1;
		// kazanan üçlüyü tutacak geçici dizi
		const lineIndices = [idx];

		// pozitif yönde say
		let rr = r + dr, cc = c + dc;
		while (
			rr >= 0 && rr < N &&
			cc >= 0 && cc < N &&
			board[rr * N + cc] === player
		) {
			count++;
			lineIndices.push(rr * N + cc);
			rr += dr;
			cc += dc;
		}

		// negatif yönde say
		rr = r - dr; cc = c - dc;
		while (
			rr >= 0 && rr < N &&
			cc >= 0 && cc < N &&
			board[rr * N + cc] === player
		) {
			count++;
			lineIndices.push(rr * N + cc);
			rr -= dr;
			cc -= dc;
		}

		if (count >= K) {
			return { player, line: lineIndices };
		}
	}

	return null;
}
