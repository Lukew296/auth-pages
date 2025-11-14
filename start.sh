#!/bin/sh
PORT=8080
echo "Starting local static server at http://localhost:$PORT"
python3 -m http.server $PORT