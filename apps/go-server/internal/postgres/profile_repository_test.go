package postgres

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestConfigureTLSForcesVerifiedTLS(t *testing.T) {
	caPath := writeTestCA(t)
	connectionStrings := []string{
		"postgresql://user:pass@db.example.com/app",
		"postgresql://user:pass@db.example.com/app?sslmode=prefer",
		"postgresql://user:pass@db.example.com/app?sslmode=require",
		"postgresql://user:pass@db.example.com/app?sslmode=verify-ca",
		"postgresql://user:pass@db.example.com/app?sslmode=verify-full",
	}

	for _, connectionString := range connectionStrings {
		t.Run(connectionString, func(t *testing.T) {
			poolConfig, err := pgxpool.ParseConfig(connectionString)
			if err != nil {
				t.Fatalf("ParseConfig returned an error: %v", err)
			}
			if err := configureTLS(poolConfig, caPath); err != nil {
				t.Fatalf("configureTLS returned an error: %v", err)
			}

			tlsConfig := poolConfig.ConnConfig.TLSConfig
			if tlsConfig == nil {
				t.Fatal("TLSConfig is nil")
			}
			if tlsConfig.InsecureSkipVerify {
				t.Fatal("InsecureSkipVerify is true")
			}
			if tlsConfig.ServerName != "db.example.com" {
				t.Fatalf("ServerName = %q, want db.example.com", tlsConfig.ServerName)
			}
			if tlsConfig.RootCAs == nil {
				t.Fatal("RootCAs is nil")
			}
			if tlsConfig.MinVersion != tls.VersionTLS12 {
				t.Fatalf("MinVersion = %d, want TLS 1.2", tlsConfig.MinVersion)
			}
			if len(poolConfig.ConnConfig.Fallbacks) != 0 {
				t.Fatalf("Fallbacks = %d, want 0", len(poolConfig.ConnConfig.Fallbacks))
			}
		})
	}
}

func TestConfigureTLSRejectsInvalidCA(t *testing.T) {
	path := filepath.Join(t.TempDir(), "invalid.pem")
	if err := os.WriteFile(path, []byte("not a certificate"), 0o600); err != nil {
		t.Fatalf("write invalid CA: %v", err)
	}
	poolConfig, err := pgxpool.ParseConfig("postgresql://user:pass@db.example.com/app")
	if err != nil {
		t.Fatalf("ParseConfig returned an error: %v", err)
	}
	if err := configureTLS(poolConfig, path); err == nil {
		t.Fatal("configureTLS returned nil error")
	}
}

func writeTestCA(t *testing.T) string {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate test CA key: %v", err)
	}
	template := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "Test CA"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign,
	}
	certificate, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatalf("create test CA: %v", err)
	}
	path := filepath.Join(t.TempDir(), "ca.pem")
	contents := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certificate})
	if err := os.WriteFile(path, contents, 0o600); err != nil {
		t.Fatalf("write test CA: %v", err)
	}
	return path
}
