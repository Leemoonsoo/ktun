FROM node:8.12.0-alpine

WORKDIR /root
ADD index.js package.json LICENSE /root/
RUN npm install && npm link

CMD ktun
