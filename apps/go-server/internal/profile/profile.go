package profile

import (
	"context"
	"errors"
	"time"
)

var ErrNotFound = errors.New("profile not found")

type Profile struct {
	GitHubID        string
	Login           string
	Name            *string
	AvatarURL       *string
	HTMLURL         string
	PublicRepos     int
	Followers       int
	Following       int
	GitHubUpdatedAt *time.Time
	FetchedAt       time.Time
}

type Repository interface {
	FindByLogin(ctx context.Context, login string) (Profile, error)
	Ping(ctx context.Context) error
}
