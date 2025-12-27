Run run this application:

1. Db up and running, table used: user_tenants, features, tenant_features
2. .env file should have all the values
   2.a) For google client Id --> URL: https://console.cloud.google.com/apis/credentials?project=searchkota
   2.b) OAuth 2.0 Client IDs --> MyAuthClient
3. Index.html file should have all the values
4. Run the node js application: node server.js
5. Run the Index.html file from VS code, status bar 'Go Live' server port: 5500, URL; http://localhost:5500/frontend/index.html

REST End points: (For API access based on scope assigned to user <-> feature)

curl --location 'http://localhost:3001/api/data/admin/settings' \
--header 'Authorization: Bearer <bearer_code>' \
--data ''

curl --location 'http://localhost:3001/api/data/general' \
--header 'Authorization: Bearer <bearer_code>' \
--data ''

Commands:

1. npm run lint
2. npm start / node server.js
