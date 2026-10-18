FROM nginx:alpine

# gettext provides envsubst, used by entrypoint.sh to render server_name from env.
# `apk upgrade` first: the base image lags the Alpine security repo (Snyk flagged
# zlib/expat fixed upstream but not yet in nginx:alpine), so take OS fixes at build.
RUN apk upgrade --no-cache && apk add --no-cache openssl curl gettext
COPY nginx.conf /etc/nginx/nginx.conf

# The site config is a TEMPLATE; entrypoint.sh renders it into conf.d at start so a
# forker can set their domain via env without editing tracked source. Remove nginx's
# stock default.conf so only the rendered config is active.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY default.conf.template /etc/nginx/templates/default.conf.template
# Committed safe defaults (real_ip trust + CLOSED admin allowlist). entrypoint.sh
# regenerates both from env at start via generate-admin-config.sh; these are the
# baked-in fallbacks so `nginx -t` and startup always have a valid file to include.
COPY real_ip.conf /etc/nginx/real_ip.conf
COPY admin_allowlist.conf /etc/nginx/admin_allowlist.conf
COPY generate-admin-config.sh /generate-admin-config.sh
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh /generate-admin-config.sh

EXPOSE 80 443

ENTRYPOINT ["/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
