#!/bin/bash
npx pkg --compress GZip -t node18-mac-arm64 index.js
sudo mv -f index /usr/local/bin/veracryptor
sudo chown root:staff /usr/local/bin/veracryptor
