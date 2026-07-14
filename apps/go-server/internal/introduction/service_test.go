package introduction

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/Chi111/aws-test/apps/go-server/internal/profile"
)

type fakeRepository struct {
	findLogin string
	result    profile.Profile
	findErr   error
	pingErr   error
}

func (repository *fakeRepository) FindByLogin(_ context.Context, login string) (profile.Profile, error) {
	repository.findLogin = login
	return repository.result, repository.findErr
}

func (repository *fakeRepository) Ping(context.Context) error {
	return repository.pingErr
}

func TestGenerateIntroduction(t *testing.T) {
	name := "Octo Cat"
	repository := &fakeRepository{result: profile.Profile{
		GitHubID:    "123",
		Login:       "octocat",
		Name:        &name,
		PublicRepos: 5,
		Followers:   10,
		Following:   2,
	}}

	result, err := NewService(repository).Generate(context.Background(), "OctoCat")
	if err != nil {
		t.Fatalf("Generate returned an error: %v", err)
	}
	if repository.findLogin != "octocat" {
		t.Fatalf("repository login = %q, want octocat", repository.findLogin)
	}
	want := "你好，我是 Octo Cat（GitHub: @octocat）。我目前有 5 个公开仓库，10 位关注者，并关注了 2 位开发者。"
	if result.Introduction != want {
		t.Fatalf("Introduction = %q, want %q", result.Introduction, want)
	}
}

func TestGenerateUsesLoginWhenNameIsEmpty(t *testing.T) {
	emptyName := "  "
	repository := &fakeRepository{result: profile.Profile{Login: "octocat", Name: &emptyName}}

	result, err := NewService(repository).Generate(context.Background(), "octocat")
	if err != nil {
		t.Fatalf("Generate returned an error: %v", err)
	}
	if !strings.Contains(result.Introduction, "我是 octocat") {
		t.Fatalf("Introduction did not fall back to login: %q", result.Introduction)
	}
}

func TestGenerateRejectsInvalidUsernames(t *testing.T) {
	invalid := []string{"", " ", "-octo", "octo-", "octo_cat", "octo cat", "中文", strings.Repeat("a", 40)}
	for _, username := range invalid {
		t.Run(username, func(t *testing.T) {
			repository := &fakeRepository{}
			_, err := NewService(repository).Generate(context.Background(), username)
			if !errors.Is(err, ErrInvalidUsername) {
				t.Fatalf("Generate error = %v, want ErrInvalidUsername", err)
			}
			if repository.findLogin != "" {
				t.Fatal("repository was called for invalid username")
			}
		})
	}
}

func TestGeneratePropagatesRepositoryError(t *testing.T) {
	want := errors.New("database unavailable")
	repository := &fakeRepository{findErr: want}
	_, err := NewService(repository).Generate(context.Background(), "octocat")
	if !errors.Is(err, want) {
		t.Fatalf("Generate error = %v, want %v", err, want)
	}
}
