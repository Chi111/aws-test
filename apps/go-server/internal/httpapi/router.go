package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/Chi111/aws-test/apps/go-server/internal/introduction"
	"github.com/Chi111/aws-test/apps/go-server/internal/profile"
)

type Handler struct {
	repository   profile.Repository
	introduction *introduction.Service
	logger       *slog.Logger
	queryTimeout time.Duration
	corsOrigin   string
}

func NewHandler(repository profile.Repository, service *introduction.Service, logger *slog.Logger, queryTimeout time.Duration, corsOrigin string) http.Handler {
	handler := &Handler{
		repository:   repository,
		introduction: service,
		logger:       logger,
		queryTimeout: queryTimeout,
		corsOrigin:   corsOrigin,
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", handler.health)
	mux.HandleFunc("GET /preview", handler.preview)
	mux.HandleFunc("GET /readyz", handler.ready)
	mux.HandleFunc("GET /api/v1/introductions/{username}", handler.generateIntroduction)
	return handler.cors(mux)
}

func (handler *Handler) health(response http.ResponseWriter, _ *http.Request) {
	writeJSON(response, http.StatusOK, map[string]string{
		"status":  "ok",
		"service": "github-profile-go",
	})
}

func (handler *Handler) preview(response http.ResponseWriter, _ *http.Request) {
	writeJSON(response, http.StatusOK, map[string]string{
		"environment": "pull-request",
		"service":     "github-profile-go",
		"status":      "ok",
	})
}

func (handler *Handler) ready(response http.ResponseWriter, request *http.Request) {
	ctx, cancel := context.WithTimeout(request.Context(), handler.queryTimeout)
	defer cancel()
	if err := handler.repository.Ping(ctx); err != nil {
		handler.logger.Warn("database readiness check failed", "category", "database_unavailable")
		writeJSON(response, http.StatusServiceUnavailable, map[string]string{"status": "not_ready"})
		return
	}
	writeJSON(response, http.StatusOK, map[string]string{"status": "ready"})
}

func (handler *Handler) generateIntroduction(response http.ResponseWriter, request *http.Request) {
	result, err := handler.introduction.Generate(request.Context(), request.PathValue("username"))
	if err != nil {
		switch {
		case errors.Is(err, introduction.ErrInvalidUsername):
			writeAPIError(response, http.StatusBadRequest, "invalid_username", "GitHub username is invalid")
		case errors.Is(err, profile.ErrNotFound):
			writeAPIError(response, http.StatusNotFound, "profile_not_found", "GitHub profile was not found")
		default:
			handler.logger.Error("generate introduction failed", "category", "repository_error")
			writeAPIError(response, http.StatusServiceUnavailable, "service_unavailable", "Profile service is temporarily unavailable")
		}
		return
	}

	writeJSON(response, http.StatusOK, introductionResponse{
		Profile: profileResponse{
			GitHubID:    result.Profile.GitHubID,
			Login:       result.Profile.Login,
			Name:        result.Profile.Name,
			AvatarURL:   result.Profile.AvatarURL,
			HTMLURL:     result.Profile.HTMLURL,
			PublicRepos: result.Profile.PublicRepos,
			Followers:   result.Profile.Followers,
			Following:   result.Profile.Following,
		},
		Introduction: result.Introduction,
	})
}

func (handler *Handler) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Origin") == handler.corsOrigin {
			response.Header().Set("Access-Control-Allow-Origin", handler.corsOrigin)
			response.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
			response.Header().Set("Access-Control-Allow-Headers", "content-type")
			response.Header().Set("Vary", "Origin")
		}
		if request.Method == http.MethodOptions {
			response.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(response, request)
	})
}

type profileResponse struct {
	GitHubID    string  `json:"githubId"`
	Login       string  `json:"login"`
	Name        *string `json:"name"`
	AvatarURL   *string `json:"avatarUrl"`
	HTMLURL     string  `json:"htmlUrl"`
	PublicRepos int     `json:"publicRepos"`
	Followers   int     `json:"followers"`
	Following   int     `json:"following"`
}

type introductionResponse struct {
	Profile      profileResponse `json:"profile"`
	Introduction string          `json:"introduction"`
}

type errorResponse struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func writeAPIError(response http.ResponseWriter, status int, code, message string) {
	body := errorResponse{}
	body.Error.Code = code
	body.Error.Message = message
	writeJSON(response, status, body)
}

func writeJSON(response http.ResponseWriter, status int, value any) {
	response.Header().Set("Content-Type", "application/json; charset=utf-8")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}
