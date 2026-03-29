FROM oven/bun:latest

COPY . /agent/
WORKDIR /agent

RUN bun install

# Create output directory
RUN mkdir -p /outputs
