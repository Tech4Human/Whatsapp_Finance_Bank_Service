FROM node:20-alpine

#Set working directory inside the container
WORKDIR /app

#Copy package files first - Docker caches this layer
COPY package*.json ./

#Install production dependencies only 
RUN npm ci --omit=dev

#Copy your source code 
COPY src/ ./src/
COPY public/ ./public/

#Expose the port your server listens on 
EXPOSE 4000

#Start the server 
CMD ["node", "src/server.js"]