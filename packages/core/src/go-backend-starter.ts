import { mutateOwnedStage, type OwnedStage } from './staging.js'

export async function writeGoBackendStarter(stage: OwnedStage, projectName: string, modulePath: string): Promise<string[]> {
  const prefix = `${projectName}/`
  const files: Record<string, string> = {
    'go.mod': `module ${modulePath}\n\ngo 1.22.0\n`,
    '.env.example': 'HOST=127.0.0.1\nPORT=3000\n',
    '.gitignore': '.env\n*.exe\n',
    'cmd/server/main.go': `package main

import (
	"context"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"${modulePath}/internal/server"
)

func main() {
	host := os.Getenv("HOST")
	if host == "" {
		host = "127.0.0.1"
	}
	port := 3000
	if value := os.Getenv("PORT"); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed < 1 || parsed > 65535 {
			log.Fatal("PORT must be an integer between 1 and 65535")
		}
		port = parsed
	}

	api := server.New(net.JoinHostPort(host, strconv.Itoa(port)), "${projectName} API")
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	serveError := make(chan error, 1)
	go func() { serveError <- api.ListenAndServe() }()

	select {
	case err := <-serveError:
		if !errors.Is(err, http.ErrServerClosed) {
			log.Fatal(err)
		}
		return
	case <-ctx.Done():
	}

	shutdownContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := api.Shutdown(shutdownContext); err != nil {
		log.Printf("graceful shutdown failed: %v", err)
		_ = api.Close()
		os.Exit(1)
	}
	if err := <-serveError; !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
`,
    'internal/handlers/health.go': `package handlers

import (
	"encoding/json"
	"net/http"
)

func Health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		return
	}
}
`,
    'internal/handlers/info.go': `package handlers

import "net/http"

func Info(name string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"name": name, "version": "0.1.0"})
	}
}
`,
    'internal/server/server.go': `package server

import (
	"log"
	"net/http"
	"time"

	"${modulePath}/internal/handlers"
)

func New(address, serviceName string) *http.Server {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", handlers.Health)
	mux.HandleFunc("GET /api/info", handlers.Info(serviceName))
	mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte("{\\"error\\":{\\"code\\":\\"NOT_FOUND\\",\\"message\\":\\"Route not found.\\"}}\\n"))
	})

	return &http.Server{
		Addr:              address,
		Handler:           requestLogger(mux),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
}

func requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(started).Round(time.Millisecond))
	})
}
`,
    'internal/server/server_test.go': `package server

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestRoutesReturnJSONAndStatusCodes(t *testing.T) {
	api := New("127.0.0.1:0", "sample-api API")
	testServer := httptest.NewServer(api.Handler)
	t.Cleanup(testServer.Close)

	response, err := http.Get(testServer.URL + "/health")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var health map[string]string
	if response.StatusCode != http.StatusOK || json.NewDecoder(response.Body).Decode(&health) != nil || health["status"] != "ok" {
		t.Fatalf("unexpected health response: status=%d body=%v", response.StatusCode, health)
	}

	response, err = http.Get(testServer.URL + "/api/info")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var info map[string]string
	if response.StatusCode != http.StatusOK || json.NewDecoder(response.Body).Decode(&info) != nil || info["name"] != "sample-api API" || info["version"] != "0.1.0" {
		t.Fatalf("unexpected info response: status=%d body=%v", response.StatusCode, info)
	}

	response, err = http.Get(testServer.URL + "/missing")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNotFound || response.Header.Get("Content-Type") != "application/json; charset=utf-8" {
		t.Fatalf("unexpected missing-route response: status=%d content-type=%q", response.StatusCode, response.Header.Get("Content-Type"))
	}
}

func TestServerUsesRequestTimeouts(t *testing.T) {
	api := New("127.0.0.1:0", "sample-api API")
	if api.ReadHeaderTimeout <= 0 || api.ReadTimeout <= 0 || api.WriteTimeout <= 0 || api.IdleTimeout <= 0 {
		t.Fatal("all HTTP request timeouts must be configured")
	}
}

func TestGracefulShutdownClosesListener(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	api := New(listener.Addr().String(), "sample-api API")
	serveError := make(chan error, 1)
	go func() { serveError <- api.Serve(listener) }()

	response, err := http.Get("http://" + listener.Addr().String() + "/health")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := api.Shutdown(ctx); err != nil {
		t.Fatal(err)
	}
	if err := <-serveError; !errors.Is(err, http.ErrServerClosed) {
		t.Fatalf("unexpected Serve result after shutdown: %v", err)
	}
}
`,
  }
  const directories = [`${prefix}cmd/server`, `${prefix}internal/handlers`, `${prefix}internal/server`]
  const writes = await mutateOwnedStage(stage, directories, Object.entries(files).map(([path, content]) => ({ path: `${prefix}${path}`, content })))
  return writes.map((path) => path.slice(prefix.length))
}
