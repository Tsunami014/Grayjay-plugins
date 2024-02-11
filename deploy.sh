#!/bin/sh
DOCUMENT_ROOT=/var/www/sources

# Take site offline
echo "Taking site offline..."
touch $DOCUMENT_ROOT/maintenance.file

# Swap over the content
echo "Deploying content..."
mkdir -p $DOCUMENT_ROOT/Odysee
cp odysee.png $DOCUMENT_ROOT/Odysee
cp OdyseeConfig.json $DOCUMENT_ROOT/Odysee
cp OdyseeScript.js $DOCUMENT_ROOT/Odysee
sh sign.sh $DOCUMENT_ROOT/Odysee/OdyseeScript.js $DOCUMENT_ROOT/Odysee/OdyseeConfig.json

# Notify Cloudflare to wipe the CDN cache
echo "Purging Cloudflare cache for zone $CLOUDFLARE_ZONE_ID..."
curl -X POST "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/purge_cache" \
     -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
     -H "Content-Type: application/json" \
     --data '{"files":["https://plugins.grayjay.app/Odysee/odysee.png", "https://plugins.grayjay.app/Odysee/OdyseeConfig.json", "https://plugins.grayjay.app/Odysee/OdyseeScript.js"]}'

# Take site back online
echo "Bringing site back online..."
rm $DOCUMENT_ROOT/maintenance.file
