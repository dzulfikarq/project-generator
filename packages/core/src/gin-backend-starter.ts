import { mutateOwnedStage, type OwnedStage } from './staging.js'
import { createGinGoMod, GIN_GO_SUM } from './gin-module-graph.js'

export async function writeGinBackendStarter(stage: OwnedStage, projectName: string, modulePath: string): Promise<string[]> {
  const prefix = `${projectName}/`
  const files: Record<string, string> = {
    'go.mod': createGinGoMod(modulePath),
    'go.sum': GIN_GO_SUM,
    '.gitignore': '*.exe\n',
    'cmd/server/main.go': `package main

import (
	"context"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"

	"${modulePath}/internal/server"
)

func main() {
	port := 3000
	if value := os.Getenv("PORT"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed < 1 || parsed > 65535 {
			log.Fatal("PORT must be an integer between 1 and 65535")
		}
		port = parsed
	}

	address := net.JoinHostPort("127.0.0.1", strconv.Itoa(port))
	api := server.New(address, "${projectName} API")
	listener, err := net.Listen("tcp", address)
	if err != nil {
		log.Fatal(err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := server.Serve(ctx, api, listener); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
`,
    'internal/server/server.go': `package server

import (
	"context"
	"errors"
	"net"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

func New(address, serviceName string) *http.Server {
	router := gin.New()
	router.Use(gin.Recovery())
	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})
	router.GET("/api/info", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"name": serviceName, "version": "0.1.0"})
	})
	router.NoRoute(func(c *gin.Context) {
		c.JSON(http.StatusNotFound, gin.H{"error": gin.H{"code": "NOT_FOUND", "message": "Route not found."}})
	})
	return &http.Server{
		Addr:              address,
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
}

func Serve(ctx context.Context, api *http.Server, listener net.Listener) error {
	serveError := make(chan error, 1)
	go func() { serveError <- api.Serve(listener) }()
	select {
	case err := <-serveError:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
	}

	shutdownContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := api.Shutdown(shutdownContext); err != nil {
		_ = api.Close()
		return err
	}
	err := <-serveError
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
}
`,
    'internal/server/server_test.go': `package server

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestRoutesReturnJSONAndStatusCodes(t *testing.T) {
	api := New("127.0.0.1:0", "sample-api API")
	for _, test := range []struct {
		path       string
		statusCode int
		want       map[string]any
	}{
		{path: "/health", statusCode: http.StatusOK, want: map[string]any{"status": "ok"}},
		{path: "/api/info", statusCode: http.StatusOK, want: map[string]any{"name": "sample-api API", "version": "0.1.0"}},
	} {
		response := httptest.NewRecorder()
		api.Handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, test.path, nil))
		var body map[string]any
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatalf("%s returned invalid JSON: %v", test.path, err)
		}
		if response.Code != test.statusCode || response.Header().Get("Content-Type") != "application/json; charset=utf-8" {
			t.Fatalf("%s returned status=%d content-type=%q", test.path, response.Code, response.Header().Get("Content-Type"))
		}
		for key, value := range test.want {
			if body[key] != value {
				t.Fatalf("%s response %q = %v, want %v", test.path, key, body[key], value)
			}
		}
	}

	response := httptest.NewRecorder()
	api.Handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/missing", nil))
	if response.Code != http.StatusNotFound {
		t.Fatalf("missing route returned status %d", response.Code)
	}
}

func TestGracefulShutdownClosesListener(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	api := New(listener.Addr().String(), "sample-api API")
	ctx, cancel := context.WithCancel(context.Background())
	serveError := make(chan error, 1)
	go func() { serveError <- Serve(ctx, api, listener) }()

	response, err := http.Get("http://" + listener.Addr().String() + "/health")
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	response.Body.Close()
	cancel()
	select {
	case err := <-serveError:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("server did not shut down after cancellation")
	}
	if _, err := net.DialTimeout("tcp", listener.Addr().String(), 100*time.Millisecond); err == nil {
		t.Fatal("listener remained open after graceful shutdown")
	}
}
`,
  }
  const directories = [`${prefix}cmd/server`, `${prefix}internal/server`]
  const writes = await mutateOwnedStage(stage, directories, Object.entries(files).map(([path, content]) => ({ path: `${prefix}${path}`, content })))
  return writes.map((path) => path.slice(prefix.length))
}
