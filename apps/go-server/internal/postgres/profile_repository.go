package postgres

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/Chi111/aws-test/apps/go-server/internal/profile"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PoolOptions struct {
	DatabaseURL string
	SSLCAPath   string
	MaxConns    int32
	MinConns    int32
}

func NewPool(ctx context.Context, options PoolOptions) (*pgxpool.Pool, error) {
	poolConfig, err := pgxpool.ParseConfig(options.DatabaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse database configuration: %w", err)
	}
	poolConfig.MaxConns = options.MaxConns
	poolConfig.MinConns = options.MinConns
	poolConfig.MaxConnLifetime = 30 * time.Minute
	poolConfig.HealthCheckPeriod = 30 * time.Second

	if options.SSLCAPath != "" {
		if err := configureTLS(poolConfig, options.SSLCAPath); err != nil {
			return nil, err
		}
	}

	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return nil, fmt.Errorf("create database pool: %w", err)
	}
	return pool, nil
}

func configureTLS(poolConfig *pgxpool.Config, caPath string) error {
	caPEM, err := os.ReadFile(caPath)
	if err != nil {
		return fmt.Errorf("read database CA bundle: %w", err)
	}
	roots, err := x509.SystemCertPool()
	if err != nil {
		roots = x509.NewCertPool()
	}
	if !roots.AppendCertsFromPEM(caPEM) {
		return errors.New("database CA bundle did not contain a valid certificate")
	}

	tlsConfig := &tls.Config{
		MinVersion: tls.VersionTLS12,
		RootCAs:    roots,
		ServerName: poolConfig.ConnConfig.Host,
	}
	poolConfig.ConnConfig.TLSConfig = tlsConfig
	// A CA path means verify-full: never inherit sslmode=prefer/allow plaintext
	// fallbacks or insecure verification settings from the connection string.
	poolConfig.ConnConfig.Fallbacks = nil
	return nil
}

type Repository struct {
	pool         *pgxpool.Pool
	queryTimeout time.Duration
}

func NewRepository(pool *pgxpool.Pool, queryTimeout time.Duration) *Repository {
	return &Repository{pool: pool, queryTimeout: queryTimeout}
}

func (repository *Repository) FindByLogin(ctx context.Context, login string) (profile.Profile, error) {
	ctx, cancel := context.WithTimeout(ctx, repository.queryTimeout)
	defer cancel()

	const query = `
		SELECT
			github_id,
			login,
			name,
			avatar_url,
			html_url,
			public_repos,
			followers,
			following,
			github_updated_at,
			fetched_at
		FROM github_profiles
		WHERE lower(login) = lower($1)
		LIMIT 1`

	var stored profile.Profile
	var name pgtype.Text
	var avatarURL pgtype.Text
	var githubUpdatedAt pgtype.Timestamptz
	err := repository.pool.QueryRow(ctx, query, login).Scan(
		&stored.GitHubID,
		&stored.Login,
		&name,
		&avatarURL,
		&stored.HTMLURL,
		&stored.PublicRepos,
		&stored.Followers,
		&stored.Following,
		&githubUpdatedAt,
		&stored.FetchedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return profile.Profile{}, profile.ErrNotFound
	}
	if err != nil {
		return profile.Profile{}, fmt.Errorf("find profile by login: %w", err)
	}
	if name.Valid {
		stored.Name = &name.String
	}
	if avatarURL.Valid {
		stored.AvatarURL = &avatarURL.String
	}
	if githubUpdatedAt.Valid {
		stored.GitHubUpdatedAt = &githubUpdatedAt.Time
	}
	return stored, nil
}

func (repository *Repository) Ping(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, repository.queryTimeout)
	defer cancel()
	if err := repository.pool.Ping(ctx); err != nil {
		return fmt.Errorf("ping database: %w", err)
	}
	return nil
}
