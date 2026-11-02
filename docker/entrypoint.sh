#!/bin/sh
set -eu
umask 077
case "${1:-serve}" in
  bootstrap)
    exec node /opt/super-agent/bootstrap.mjs
    ;;
  prepare)
    mkdir -p /paperclip/home /paperclip/npm-cache /paperclip/logs
    cd /opt/paperclip
    if [ -f .super-agent-installed ]; then
      node /opt/super-agent/verify-install.mjs
      exit 0
    fi
    if [ -f package.json ]; then
      cmp /opt/super-agent/package.install.json package.json
    else
      cp /opt/super-agent/package.install.json package.json
    fi
    sa_install_id=$(node -e 'console.log(require("node:crypto").randomUUID())')
    printf '{"stage":"dependency-lock","log":"/paperclip/logs/dependency-lock-%s.log","modelCalls":0}\n' "$sa_install_id"
    if [ ! -f package-lock.json ]; then
      cp /opt/super-agent/package-lock.install.json package-lock.json
    fi
    node /opt/super-agent/complete-lock.mjs
    cmp /opt/super-agent/package-lock.install.json package-lock.json
    printf '{"stage":"dependency-install","log":"/paperclip/logs/dependency-install-%s.log","modelCalls":0}\n' "$sa_install_id"
    npm ci --engine-strict --omit=dev --include=optional --no-audit --no-fund >"/paperclip/logs/dependency-install-$sa_install_id.log" 2>&1
    node -e 'const fs=require("node:fs"),crypto=require("node:crypto");const wanted=JSON.parse(fs.readFileSync("package.json"));for(const [name,version]of Object.entries(wanted.dependencies)){const actual=JSON.parse(fs.readFileSync("node_modules/"+name+"/package.json")).version;if(actual!==version)throw Error("DEPENDENCY_VERSION_CHANGED");}const sha=crypto.createHash("sha256").update(fs.readFileSync("package-lock.json")).digest("hex");fs.writeFileSync(".super-agent-installed",JSON.stringify({lockSha256:sha,at:new Date().toISOString(),modelCalls:0}),{mode:384});console.log(JSON.stringify({stage:"dependencies-installed",lockSha256:sha,modelCalls:0}));'
    ;;
  serve)
    test -f /opt/paperclip/.super-agent-installed
    node /opt/super-agent/verify-install.mjs
    test -f /paperclip/secrets/better-auth
    test -f /paperclip/secrets/postgres-password
    export BETTER_AUTH_SECRET="$(cat /paperclip/secrets/better-auth)"
    export DATABASE_URL="postgres://paperclip:$(cat /paperclip/secrets/postgres-password)@db:5432/paperclip"
    export PATH="/opt/super-agent/bin:/opt/paperclip/node_modules/.bin:$PATH"
    exec node /opt/super-agent/serve.mjs
    ;;
  *)
    printf '%s\n' '{"errorCode":"CONTAINER_ACTION_NOT_ALLOWED"}' >&2
    exit 64
    ;;
esac
