package config

import (
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Address           string
	DatabaseURL       string
	DatabaseSSLCAPath string
	DatabaseMaxConns  int32
	DatabaseMinConns  int32
	CORSOrigin        string
	QueryTimeout      time.Duration
	ShutdownTimeout   time.Duration
}

type LookupEnv func(string) (string, bool)

func Load(lookup LookupEnv) (Config, error) {
	port := valueOrDefault(lookup, "PORT", "8080")
	portNumber, err := strconv.Atoi(port)
	if err != nil || portNumber < 1 || portNumber > 65535 {
		return Config{}, fmt.Errorf("PORT must be a number between 1 and 65535")
	}

	databaseURL, ok := lookup("DATABASE_URL")
	if !ok || strings.TrimSpace(databaseURL) == "" {
		return Config{}, errors.New("DATABASE_URL is required")
	}

	maxConns, err := int32Value(lookup, "DATABASE_MAX_CONNS", 5)
	if err != nil || maxConns < 1 {
		return Config{}, errors.New("DATABASE_MAX_CONNS must be at least 1")
	}
	minConns, err := int32Value(lookup, "DATABASE_MIN_CONNS", 0)
	if err != nil || minConns < 0 || minConns > maxConns {
		return Config{}, errors.New("DATABASE_MIN_CONNS must be between 0 and DATABASE_MAX_CONNS")
	}

	sslCAPath, _ := lookup("DATABASE_SSL_CA_PATH")

	return Config{
		Address:           net.JoinHostPort("", port),
		DatabaseURL:       databaseURL,
		DatabaseSSLCAPath: strings.TrimSpace(sslCAPath),
		DatabaseMaxConns:  maxConns,
		DatabaseMinConns:  minConns,
		CORSOrigin:        valueOrDefault(lookup, "CORS_ORIGIN", "http://localhost:3001"),
		QueryTimeout:      3 * time.Second,
		ShutdownTimeout:   10 * time.Second,
	}, nil
}

func valueOrDefault(lookup LookupEnv, key, fallback string) string {
	if value, ok := lookup(key); ok && strings.TrimSpace(value) != "" {
		return strings.TrimSpace(value)
	}
	return fallback
}

func int32Value(lookup LookupEnv, key string, fallback int32) (int32, error) {
	value, ok := lookup(key)
	if !ok || strings.TrimSpace(value) == "" {
		return fallback, nil
	}
	parsed, err := strconv.ParseInt(strings.TrimSpace(value), 10, 32)
	return int32(parsed), err
}
