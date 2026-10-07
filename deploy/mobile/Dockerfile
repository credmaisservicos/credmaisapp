FROM node:22-bookworm-slim AS node
FROM eclipse-temurin:21-jdk-jammy
RUN apt-get update && apt-get install -y --no-install-recommends python3 curl unzip ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx
ENV ANDROID_HOME=/opt/android-sdk
COPY setup-sdk.py /tmp/setup-sdk.py
COPY licenses/ /opt/android-sdk/licenses/
RUN python3 /tmp/setup-sdk.py
WORKDIR /build
