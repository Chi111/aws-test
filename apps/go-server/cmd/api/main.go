package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Chi111/aws-test/apps/go-server/internal/config"
	"github.com/Chi111/aws-test/apps/go-server/internal/httpapi"
	"github.com/Chi111/aws-test/apps/go-server/internal/introduction"
	"github.com/Chi111/aws-test/apps/go-server/internal/postgres"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(logger); err != nil {
		logger.Error("server stopped", "error", err)
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	appConfig, err := config.Load(os.LookupEnv)
	if err != nil {
		return fmt.Errorf("load configuration: %w", err)
	}

	pool, err := postgres.NewPool(context.Background(), postgres.PoolOptions{
		DatabaseURL: appConfig.DatabaseURL,
		SSLCAPath:   appConfig.DatabaseSSLCAPath,
		MaxConns:    appConfig.DatabaseMaxConns,
		MinConns:    appConfig.DatabaseMinConns,
	})
	if err != nil {
		return err
	}
	defer pool.Close()

	repository := postgres.NewRepository(pool, appConfig.QueryTimeout)
	service := introduction.NewService(repository)
	server := &http.Server{
		Addr:              appConfig.Address,
		Handler:           httpapi.NewHandler(repository, service, logger, appConfig.QueryTimeout, appConfig.CORSOrigin),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	serverErrors := make(chan error, 1)
	go func() {
		logger.Info("HTTP server started", "address", appConfig.Address)
		serverErrors <- server.ListenAndServe()
	}()

	signalContext, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	select {
	case err := <-serverErrors:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return fmt.Errorf("serve HTTP: %w", err)
	case <-signalContext.Done():
		logger.Info("shutdown signal received")
	}

	shutdownContext, cancel := context.WithTimeout(context.Background(), appConfig.ShutdownTimeout)
	defer cancel()
	if err := server.Shutdown(shutdownContext); err != nil {
		return fmt.Errorf("shutdown HTTP server: %w", err)
	}
	if err := <-serverErrors; !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("serve HTTP: %w", err)
	}
	logger.Info("HTTP server stopped")
	return nil
}
