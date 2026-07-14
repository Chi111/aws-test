package introduction

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/Chi111/aws-test/apps/go-server/internal/profile"
)

var ErrInvalidUsername = errors.New("invalid GitHub username")

var usernamePattern = regexp.MustCompile(`^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$|^[a-zA-Z0-9]$`)

type Service struct {
	repository profile.Repository
}

type Result struct {
	Profile      profile.Profile
	Introduction string
}

func NewService(repository profile.Repository) *Service {
	return &Service{repository: repository}
}

func (service *Service) Generate(ctx context.Context, username string) (Result, error) {
	username = strings.TrimSpace(username)
	if !usernamePattern.MatchString(username) {
		return Result{}, ErrInvalidUsername
	}

	stored, err := service.repository.FindByLogin(ctx, strings.ToLower(username))
	if err != nil {
		return Result{}, err
	}

	displayName := stored.Login
	if stored.Name != nil && strings.TrimSpace(*stored.Name) != "" {
		displayName = strings.TrimSpace(*stored.Name)
	}

	return Result{
		Profile: stored,
		Introduction: fmt.Sprintf(
			"你好，我是 %s（GitHub: @%s）。我目前有 %d 个公开仓库，%d 位关注者，并关注了 %d 位开发者。",
			displayName,
			stored.Login,
			stored.PublicRepos,
			stored.Followers,
			stored.Following,
		),
	}, nil
}
