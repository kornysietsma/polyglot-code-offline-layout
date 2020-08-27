FROM node:14

WORKDIR /app
COPY package.json .
RUN npm install --production
COPY layout.js .
CMD ["node","layout.js"]
USER node
