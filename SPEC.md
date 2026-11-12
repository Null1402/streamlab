\# SPEC StreamLab (clon ligero de Twitch)

Eres mi asistente de código. Este archivo es la ÚNICA fuente de verdad del proyecto.

Responde SOLO con el código del archivo que te pida, completo y sin explicaciones.



\## Stack (no cambiar)

Node.js 22 LTS, CommonJS (`require`). Sin TypeScript, sin frameworks de frontend.

`express@4`, `socket.io@4`, `node-media-server@2.7.0` (versión exacta), `bcryptjs`, `dotenv`, `hls.js`.

Base de datos: `node:sqlite` (DatabaseSync), archivo `data/streamlab.db`. NO usar módulos nativos.

`ffmpeg` del sistema (ruta en `FFMPEG\_PATH`, por defecto `/usr/bin/ffmpeg`).

Interfaz 100% en español.



\## Estructura

`server.js`       Express + API + Socket.io + node-media-server

`db.js`           Conexión y creación de tablas

`public/`         styles.css, common.js, index.html, channel.html, login.html, dashboard.html

`deploy/`         setup-ec2.sh

`media/`          (generado) HLS, VOD mp4 y miniaturas por usuario

`data/`           (generado) base de datos



\## Base de datos

`users` (id, username UNIQUE, password\_hash, stream\_key, title, category, bio, is\_live 0/1, created\_at)

`sessions` (token PK, user\_id, created\_at) -> cookie HttpOnly `sl\_token` (7 días)

`follows` (follower\_id, channel\_id) PK compuesta



\## Reglas de negocio

`username`: `^\[a-z0-9\_]{3,20}$`; contraseña >= 6 (bcrypt, 10 rondas).

`stream\_key`: `sk\_` + 24 hex aleatorios. Categorías fijas: Videojuegos, Programación, Educación, Música, Charlas, Arte.

OBS publica en `rtmp://HOST:1935/live` con clave `USUARIO?key=STREAM\_KEY`.

En `prePublish` validar usuario+clave; si no coincide `nms.getSession(id).reject()`.

Así la URL pública (`/media/live/USUARIO/index.m3u8`) NO expone la clave.

`postPublish` -> is\_live=1, emitir 'live' por socket, miniatura con ffmpeg cada 30 s (`thumb.jpg`).

`donePublish` -> is\_live=0, emitir 'live'. Al arrancar el servidor: is\_live=0 para todos.

Transmux sin recodificar (copy): HLS `\[hls\_time=2:hls\_list\_size=4:hls\_flags=delete\_segments]`

VOD MP4 `\[movflags=frag\_keyframe+empty\_moov]` (si `RECORD\_VOD !== 'false'`).



\## API REST (JSON)

`POST /api/register`

`POST /api/login`

`POST /api/logout`

`GET /api/me`

`GET /api/categories` (con nº en vivo)

`GET /api/channels?category=\&live=1`

`GET /api/channels/:username` (incluye following, hls, vods\[])

`POST /api/channels/:username/follow` (toggle)

`GET /api/following`

`GET/PUT /api/dashboard`

`POST /api/dashboard/regenerate-key`

`GET /api/health`

Ruta web `/c/:username` -> `channel.html`. Estático: `/media` (no-cache en .m3u8), `/vendor/hls.js`.

`rtmp\_url` del panel -> `rtmp://${PUBLIC\_HOST || req.hostname}:1935/live`.



\# SPEC StreamLab (clon ligero de Twitch)

Eres mi asistente de código. Este archivo es la ÚNICA fuente de verdad del proyecto.

Responde SOLO con el código del archivo que te pida, completo y sin explicaciones.



\## Stack (no cambiar)

Node.js 22 LTS, CommonJS (`require`). Sin TypeScript, sin frameworks de frontend.

`express@4`, `socket.io@4`, `node-media-server@2.7.0` (versión exacta), `bcryptjs`, `dotenv`, `hls.js`.

Base de datos: `node:sqlite` (DatabaseSync), archivo `data/streamlab.db`. NO usar módulos nativos.

`ffmpeg` del sistema (ruta en `FFMPEG\_PATH`, por defecto `/usr/bin/ffmpeg`).

Interfaz 100% en español.



\## Estructura

`server.js`       Express + API + Socket.io + node-media-server

`db.js`           Conexión y creación de tablas

`public/`         styles.css, common.js, index.html, channel.html, login.html, dashboard.html

`deploy/`         setup-ec2.sh

`media/`          (generado) HLS, VOD mp4 y miniaturas por usuario

`data/`           (generado) base de datos



\## Base de datos

`users` (id, username UNIQUE, password\_hash, stream\_key, title, category, bio, is\_live 0/1, created\_at)

`sessions` (token PK, user\_id, created\_at) -> cookie HttpOnly `sl\_token` (7 días)

`follows` (follower\_id, channel\_id) PK compuesta



\## Reglas de negocio

`username`: `^\[a-z0-9\_]{3,20}$`; contraseña >= 6 (bcrypt, 10 rondas).

`stream\_key`: `sk\_` + 24 hex aleatorios. Categorías fijas: Videojuegos, Programación, Educación, Música, Charlas, Arte.

OBS publica en `rtmp://HOST:1935/live` con clave `USUARIO?key=STREAM\_KEY`.

En `prePublish` validar usuario+clave; si no coincide `nms.getSession(id).reject()`.

Así la URL pública (`/media/live/USUARIO/index.m3u8`) NO expone la clave.

`postPublish` -> is\_live=1, emitir 'live' por socket, miniatura con ffmpeg cada 30 s (`thumb.jpg`).

`donePublish` -> is\_live=0, emitir 'live'. Al arrancar el servidor: is\_live=0 para todos.

Transmux sin recodificar (copy): HLS `\[hls\_time=2:hls\_list\_size=4:hls\_flags=delete\_segments]`

VOD MP4 `\[movflags=frag\_keyframe+empty\_moov]` (si `RECORD\_VOD !== 'false'`).



\## API REST (JSON)

`POST /api/register`

`POST /api/login`

`POST /api/logout`

`GET /api/me`

`GET /api/categories` (con nº en vivo)

`GET /api/channels?category=\&live=1`

`GET /api/channels/:username` (incluye following, hls, vods\[])

`POST /api/channels/:username/follow` (toggle)

`GET /api/following`

`GET/PUT /api/dashboard`

`POST /api/dashboard/regenerate-key`

`GET /api/health`

Ruta web `/c/:username` -> `channel.html`. Estático: `/media` (no-cache en .m3u8), `/vendor/hls.js`.

`rtmp\_url` del panel -> `rtmp://${PUBLIC\_HOST || req.hostname}:1935/live`.



\## Socket.io

Cliente `join(canal)`, `chat(texto)`. Servidor `chat {user, text, color, at}`, `viewers {n}`, `live {username, live}`, `channel:update {title, category}`, `chat:error {texto}`.

Solo usuarios con sesión chatean; máx. 300 caracteres; 1 mensaje cada 700 ms.

Espectadores -> tamaño de la sala `ch:<usuario>`.



\## Estilo visual

Tema oscuro: fondo #0f1115, paneles #171a21/#1f232c, bordes #2a2f3a, acento #2ec4b6, coral #ff7a59, en vivo #ff3b5c. Fuente Inter/system-ui. Barra superior fija, sidebar de canales, tarjetas 16:9, página de canal con reproductor + chat lateral de 340 px. Responsive (<900 px oculta sidebar y chat).

