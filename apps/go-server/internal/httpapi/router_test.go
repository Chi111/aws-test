package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Chi111/aws-test/apps/go-server/internal/introduction"
	"github.com/Chi111/aws-test/apps/go-server/internal/profile"
)

type fakeRepository struct {
	result    profile.Profile
	findErr   error
	pingErr   error
	findCalls int
}

func (repository *fakeRepository) FindByLogin(context.Context, string) (profile.Profile, error) {
	repository.findCalls++
	return repository.result, repository.findErr
}

func (repository *fakeRepository) Ping(context.Context) error {
	return repository.pingErr
}

func testHandler(repository *fakeRepository) http.Handler {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	return NewHandler(repository, introduction.NewService(repository), logger, time.Second, "http://localhost:3001")
}

func TestHealthDoesNotUseDatabase(t *testing.T) {
	repository := &fakeRepository{pingErr: errors.New("database unavailable")}
	response := httptest.NewRecorder()
	testHandler(repository).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.Code)
	}
	if repository.findCalls != 0 {
		t.Fatal("health check queried the repository")
	}
}

func TestReadiness(t *testing.T) {
	tests := []struct {
		name       string
		pingErr    error
		wantStatus int
		wantBody   string
	}{
		{name: "ready", wantStatus: http.StatusOK, wantBody: `"status":"ready"`},
		{name: "database unavailable", pingErr: errors.New("password=secret connection failed"), wantStatus: http.StatusServiceUnavailable, wantBody: `"status":"not_ready"`},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			testHandler(&fakeRepository{pingErr: test.pingErr}).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/readyz", nil))
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", response.Code, test.wantStatus)
			}
			if !strings.Contains(response.Body.String(), test.wantBody) {
				t.Fatalf("body = %q, want to contain %q", response.Body.String(), test.wantBody)
			}
			if strings.Contains(response.Body.String(), "secret") {
				t.Fatal("response leaked the database error")
			}
		})
	}
}

func TestIntroductionResponse(t *testing.T) {
	name := "Octo Cat"
	repository := &fakeRepository{result: profile.Profile{
		GitHubID:    "123",
		Login:       "octocat",
		Name:        &name,
		HTMLURL:     "https://github.com/octocat",
		PublicRepos: 5,
		Followers:   10,
		Following:   2,
	}}
	response := httptest.NewRecorder()
	testHandler(repository).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/introductions/octocat", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body["introduction"] == "" {
		t.Fatal("introduction was empty")
	}
	proof, ok := body["backendProof"].(map[string]any)
	if !ok ||
		proof["service"] != "github-profile-go" ||
		proof["runtime"] != "go" ||
		proof["dataSource"] != "postgresql" {
		t.Fatalf("unexpected backend proof: %#v", body["backendProof"])
	}
}

func TestIntroductionErrors(t *testing.T) {
	tests := []struct {
		name       string
		path       string
		findErr    error
		wantStatus int
		wantCode   string
	}{
		{name: "invalid username", path: "/api/v1/introductions/-bad", wantStatus: http.StatusBadRequest, wantCode: "invalid_username"},
		{name: "not found", path: "/api/v1/introductions/octocat", findErr: profile.ErrNotFound, wantStatus: http.StatusNotFound, wantCode: "profile_not_found"},
		{name: "database unavailable", path: "/api/v1/introductions/octocat", findErr: errors.New("database password=secret"), wantStatus: http.StatusServiceUnavailable, wantCode: "service_unavailable"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			testHandler(&fakeRepository{findErr: test.findErr}).ServeHTTP(response, httptest.NewRequest(http.MethodGet, test.path, nil))
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", response.Code, test.wantStatus)
			}
			if !strings.Contains(response.Body.String(), test.wantCode) {
				t.Fatalf("body = %q, want code %q", response.Body.String(), test.wantCode)
			}
			if strings.Contains(response.Body.String(), "secret") {
				t.Fatal("response leaked an internal error")
			}
		})
	}
}

func TestCORSPreflight(t *testing.T) {
	request := httptest.NewRequest(http.MethodOptions, "/api/v1/introductions/octocat", nil)
	request.Header.Set("Origin", "http://localhost:3001")
	response := httptest.NewRecorder()
	testHandler(&fakeRepository{}).ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", response.Code)
	}
	if response.Header().Get("Access-Control-Allow-Origin") != "http://localhost:3001" {
		t.Fatalf("unexpected Access-Control-Allow-Origin: %q", response.Header().Get("Access-Control-Allow-Origin"))
	}
}
