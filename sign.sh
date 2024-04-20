#!/bin/sh
#USAGE:
#./sign.sh YTMusicScript.js YTMusicConfig.json

#Set your key paths here
PRIVATE_KEY_PATH=~/.ssh/id_rsa
PUBLIC_KEY_PATH=~/.ssh/id_rsa.pub

PUBLIC_KEY_PKCS8=$(ssh-keygen -f "$PUBLIC_KEY_PATH" -e -m pkcs8 | tail -n +2 | head -n -1 | tr -d '\n')
echo "This is your public key: '$PUBLIC_KEY_PKCS8'"

DATA=$(cat "$1")

SIGNATURE=$(echo -n "$DATA" | openssl dgst -sha512 -sign ~/.ssh/id_rsa | base64 -w 0)
echo "This is your signature: '$SIGNATURE'"

jq --arg signature "$SIGNATURE" --arg publicKey "$PUBLIC_KEY_PKCS8" '. + {scriptSignature: $signature, scriptPublicKey: $publicKey}' "$2" > tmp.$$.json && mv tmp.$$.json "$2"

