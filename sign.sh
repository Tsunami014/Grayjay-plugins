#!/bin/sh

# Parameters
JS_FILE_PATH=$1
CONFIG_FILE_PATH=$2

# Decode and save the private key to a temporary file
echo "$SIGNING_PRIVATE_KEY" | base64 -d > tmp_private_key.pem

# Validate private key
if ! openssl rsa -check -noout -in tmp_private_key.pem > /dev/null 2>&1; then
  echo "Invalid private key."
  rm tmp_private_key.pem
  exit 1
fi

# Generate signature for the provided JS file
SIGNATURE=$(cat $JS_FILE_PATH | openssl dgst -sha512 -sign tmp_private_key.pem | base64 -w 0)

# Extract public key from the temporary private key file
PUBLIC_KEY=$(openssl rsa -pubout -outform DER -in tmp_private_key.pem 2>/dev/null | openssl pkey -pubin -inform DER -outform PEM | tail -n +2 | head -n -1 | tr -d '\n')

echo "PUBLIC_KEY: $PUBLIC_KEY"

# Remove temporary key files
rm tmp_private_key.pem

# Update "scriptSignature" and "scriptPublicKey" fields in Config JSON
cat $CONFIG_FILE_PATH | jq --arg signature "$SIGNATURE" --arg publicKey "$PUBLIC_KEY" '. + {scriptSignature: $signature, scriptPublicKey: $publicKey}' > temp_config.json && mv temp_config.json $CONFIG_FILE_PATH