# Build with the builder machine's native architecture. Go then cross-compiles
# the static binary for the image platform requested by Docker Buildx.
FROM --platform=$BUILDPLATFORM golang:1.26.5-bookworm AS build

ARG TARGETOS
ARG TARGETARCH

WORKDIR /src
COPY apps/go-server/go.mod apps/go-server/go.sum ./
RUN go mod download
COPY apps/go-server/cmd ./cmd
COPY apps/go-server/internal ./internal
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /out/github-profile-go ./cmd/api

FROM gcr.io/distroless/static-debian12:nonroot

COPY global-bundle.pem /etc/ssl/certs/aws-rds-global-bundle.pem
COPY --from=build /out/github-profile-go /github-profile-go

EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/github-profile-go"]
