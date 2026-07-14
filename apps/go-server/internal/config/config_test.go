package config

import "testing"

func TestLoadDefaults(t *testing.T) {
	config, err := Load(env(map[string]string{"DATABASE_URL": "postgresql://localhost/app"}))
	if err != nil {
		t.Fatalf("Load returned an error: %v", err)
	}
	if config.Address != ":8080" {
		t.Fatalf("Address = %q, want :8080", config.Address)
	}
	if config.DatabaseMaxConns != 5 || config.DatabaseMinConns != 0 {
		t.Fatalf("unexpected pool settings: min=%d max=%d", config.DatabaseMinConns, config.DatabaseMaxConns)
	}
	if config.CORSOrigin != "http://localhost:3001" {
		t.Fatalf("CORSOrigin = %q", config.CORSOrigin)
	}
}

func TestLoadRejectsInvalidConfiguration(t *testing.T) {
	tests := []struct {
		name   string
		values map[string]string
	}{
		{name: "missing database URL", values: map[string]string{}},
		{name: "invalid port", values: map[string]string{"DATABASE_URL": "postgresql://localhost/app", "PORT": "70000"}},
		{name: "invalid max connections", values: map[string]string{"DATABASE_URL": "postgresql://localhost/app", "DATABASE_MAX_CONNS": "0"}},
		{name: "minimum exceeds maximum", values: map[string]string{"DATABASE_URL": "postgresql://localhost/app", "DATABASE_MAX_CONNS": "2", "DATABASE_MIN_CONNS": "3"}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := Load(env(test.values)); err == nil {
				t.Fatal("Load returned nil error")
			}
		})
	}
}

func env(values map[string]string) LookupEnv {
	return func(key string) (string, bool) {
		value, ok := values[key]
		return value, ok
	}
}
