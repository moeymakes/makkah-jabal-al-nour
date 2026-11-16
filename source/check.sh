#!/bin/sh
# dev helper: build both pages and syntax-check the bundled script (a parse error otherwise just hangs the page)
cd "$(dirname "$0")" && node build.mjs --dev && node build.mjs && for f in ../dev.html ../index.html; do
  node -e "const s=require('fs').readFileSync('$f','utf8');require('fs').writeFileSync('/tmp/claude-1000/check.mjs',s.slice(s.indexOf('<script>')+8,s.lastIndexOf('</script>')))" && node --check /tmp/claude-1000/check.mjs || exit 1; done
