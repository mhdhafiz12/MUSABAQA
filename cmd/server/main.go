package main

import (
	"compress/gzip"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type M = map[string]any

type application struct {
	root       string
	adminKey   string
	template   *template.Template
	store      *store
	sessionsMu sync.RWMutex
	sessions   map[string]time.Time
}

type pageView struct {
	Title               string
	Page                string
	FestivalDate        string
	Navigation          []navItem
	InitialJSON         template.JS
	VideoEnabled        bool
	VideoLoop           bool
	VideoURL            string
	VideoBrightness     string
	BackgroundURL       string
	BackgroundMobileURL string
	Year                int
}

type navItem struct {
	Href, Label string
	Active      bool
}

func main() {
	root, err := os.Getwd()
	if err != nil {
		log.Fatal(err)
	}
	loadDotEnv(filepath.Join(root, ".env"))

	var pool *pgxpool.Pool
	if dsn := postgresDSN(); dsn != "" {
		// Pool creation is lazy. Do not hold up the HTTP listener with a remote
		// database ping; first paint uses the local snapshot and API calls can
		// connect to PostgreSQL independently afterward.
		candidate, connectErr := pgxpool.New(context.Background(), dsn)
		if connectErr != nil {
			log.Printf("PostgreSQL configuration unavailable; using JSON data store: %v", connectErr)
		} else {
			pool = candidate
			defer pool.Close()
			log.Print("PostgreSQL pool configured; connections will open on demand")
		}
	}

	pageTemplate, err := template.ParseFiles(filepath.Join(root, "web", "index.html"))
	if err != nil {
		log.Fatal(err)
	}
	app := &application{
		root: root, adminKey: env("ADMIN_API_KEY", "123"), template: pageTemplate,
		store: newStore(root, pool), sessions: make(map[string]time.Time),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api", app.handleAPI)
	mux.HandleFunc("/api/", app.handleAPI)
	mux.Handle("/assets/", app.staticAssets())
	mux.HandleFunc("/", app.handlePage)

	address := env("APP_ADDR", ":8000")
	server := &http.Server{
		Addr: address, Handler: securityHeaders(gzipResponses(requestLogger(mux))),
		ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second,
		WriteTimeout: 30 * time.Second, IdleTimeout: 90 * time.Second,
	}
	log.Printf("Kauzariyya Go server listening on %s", address)
	log.Fatal(server.ListenAndServe())
}

func (a *application) handlePage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		methodNotAllowed(w)
		return
	}
	page, ok := pageForPath(strings.TrimSuffix(r.URL.Path, "/"))
	if !ok {
		http.NotFound(w, r)
		return
	}
	bootstrap, err := a.store.bootstrapPage(r.Context(), page)
	if err != nil {
		log.Printf("bootstrap: %v", err)
		http.Error(w, "The site is temporarily unavailable.", http.StatusServiceUnavailable)
		return
	}
	bootstrap["page"] = page
	encoded, err := json.Marshal(bootstrap)
	if err != nil {
		http.Error(w, "Could not prepare page data.", http.StatusInternalServerError)
		return
	}
	settings := mapValue(bootstrap["settings"])
	date := stringValue(settings["festival_date"])
	dateLabel := date
	if parsed, parseErr := time.Parse("2006-01-02", date); parseErr == nil {
		dateLabel = parsed.Format("02 January 2006")
	}
	titles := map[string]string{
		"home": "Al-Jamiathul Kauzariyya · Management Platform", "scoreboard": "Live Scoreboard · Kauzariyya",
		"schedule": "Program Schedule · Kauzariyya", "participants": "Participants · Kauzariyya",
		"musabaqa": "Musabaqa Programme 2026–27 · Kauzariyya",
		"review": "Share Your Review · Kauzariyya", "admin": "Admin Dashboard · Kauzariyya",
	}
	navigation := []navItem{
		{Href: "/", Label: "Home", Active: page == "home"},
		{Href: "/scoreboard", Label: "Scoreboard", Active: page == "scoreboard"},
		{Href: "/schedule", Label: "Schedule", Active: page == "schedule"},
		{Href: "/participants", Label: "Participants", Active: page == "participants"},
		{Href: "/musabaqa", Label: "Program Plan", Active: page == "musabaqa"},
		{Href: "/review", Label: "Review", Active: page == "review"},
	}
	darkness := intValue(settings["video_darkness"])
	brightness := 1 - float64(darkness)/100
	if brightness < .25 {
		brightness = .25
	}
	view := pageView{
		Title: titles[page], Page: page, FestivalDate: dateLabel, Navigation: navigation,
		InitialJSON: template.JS(encoded), VideoEnabled: boolValue(settings["intro_video_enabled"]),
		VideoLoop: boolValue(settings["intro_video_loop"]), VideoURL: stringValue(settings["intro_video_url"]),
		VideoBrightness:     strconv.FormatFloat(brightness, 'f', 2, 64),
		BackgroundURL:       map[string]string{"home": "/assets/kauzariyya4.webp", "scoreboard": "/assets/kauzariyya6.webp", "schedule": "/assets/kauzariyya5.webp", "participants": "/assets/kauzariyya7.webp", "musabaqa": "/assets/kauzariyya9.webp", "review": "/assets/kauzariyya8.webp", "admin": "/assets/kauzariyya4.webp"}[page],
		BackgroundMobileURL: map[string]string{"home": "/assets/kauzariyya4-mobile.webp", "scoreboard": "/assets/kauzariyya6-mobile.webp", "schedule": "/assets/kauzariyya5-mobile.webp", "participants": "/assets/kauzariyya7-mobile.webp", "musabaqa": "/assets/kauzariyya9-mobile.webp", "review": "/assets/kauzariyya8-mobile.webp", "admin": "/assets/kauzariyya4-mobile.webp"}[page],
		Year:                time.Now().Year(),
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	if r.Method == http.MethodHead {
		return
	}
	if err := a.template.Execute(w, view); err != nil {
		log.Printf("render page: %v", err)
	}
}

func pageForPath(path string) (string, bool) {
	routes := map[string]string{
		"": "home", "/": "home", "/index.php": "home", "/scoreboard": "scoreboard", "/scoreboard.php": "scoreboard",
		"/schedule": "schedule", "/schedule.php": "schedule", "/participants": "participants", "/participants.php": "participants",
		"/musabaqa": "musabaqa", "/musabaqa.php": "musabaqa",
		"/review": "review", "/review.php": "review", "/admin": "admin", "/admin.php": "admin",
	}
	page, ok := routes[path]
	return page, ok
}

func (a *application) staticAssets() http.Handler {
	files := http.StripPrefix("/assets/", http.FileServer(http.Dir(filepath.Join(a.root, "assets"))))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "..") {
			http.NotFound(w, r)
			return
		}
		ext := strings.ToLower(filepath.Ext(r.URL.Path))
		if ext == ".css" || ext == ".js" {
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		} else {
			w.Header().Set("Cache-Control", "public, max-age=2592000")
		}
		files.ServeHTTP(w, r)
	})
}

func (a *application) createSession(w http.ResponseWriter, r *http.Request) error {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return err
	}
	token := hex.EncodeToString(bytes)
	expires := time.Now().Add(12 * time.Hour)
	a.sessionsMu.Lock()
	for existing, expiry := range a.sessions {
		if time.Now().After(expiry) {
			delete(a.sessions, existing)
		}
	}
	a.sessions[token] = expires
	a.sessionsMu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: "kauzariyya_admin", Value: token, Path: "/", Expires: expires, MaxAge: 43200, HttpOnly: true, Secure: r.TLS != nil, SameSite: http.SameSiteStrictMode})
	return nil
}

func (a *application) clearSession(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie("kauzariyya_admin"); err == nil {
		a.sessionsMu.Lock()
		delete(a.sessions, cookie.Value)
		a.sessionsMu.Unlock()
	}
	http.SetCookie(w, &http.Cookie{Name: "kauzariyya_admin", Path: "/", MaxAge: -1, Expires: time.Unix(1, 0), HttpOnly: true, Secure: r.TLS != nil, SameSite: http.SameSiteStrictMode})
}

func (a *application) authenticated(r *http.Request) bool {
	if provided := r.Header.Get("X-Admin-Key"); provided != "" && secureEqual(a.adminKey, provided) {
		return true
	}
	cookie, err := r.Cookie("kauzariyya_admin")
	if err != nil {
		return false
	}
	a.sessionsMu.RLock()
	expires, ok := a.sessions[cookie.Value]
	a.sessionsMu.RUnlock()
	return ok && time.Now().Before(expires)
}

func secureEqual(expected, provided string) bool {
	if expected == "" || len(expected) != len(provided) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(expected), []byte(provided)) == 1
}

func loadDotEnv(path string) {
	content, err := os.ReadFile(path)
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(content), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		name, value, found := strings.Cut(line, "=")
		if !found {
			continue
		}
		name, value = strings.TrimSpace(name), strings.Trim(strings.TrimSpace(value), "\"'")
		if _, exists := os.LookupEnv(name); !exists {
			_ = os.Setenv(name, value)
		}
	}
}

func postgresDSN() string {
	host := os.Getenv("SUPABASE_DB_HOST")
	if host == "" {
		return ""
	}
	return fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=%s",
		urlQueryEscape(env("SUPABASE_DB_USER", "postgres")), urlQueryEscape(os.Getenv("SUPABASE_DB_PASSWORD")), host,
		env("SUPABASE_DB_PORT", "5432"), env("SUPABASE_DB_NAME", "postgres"), env("SUPABASE_DB_SSLMODE", "require"))
}

func urlQueryEscape(value string) string {
	replacer := strings.NewReplacer("%", "%25", ":", "%3A", "/", "%2F", "@", "%40", "?", "%3F", "#", "%23")
	return replacer.Replace(value)
}

func env(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s %s", r.Method, r.URL.RequestURI(), time.Since(started).Round(time.Millisecond))
	})
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		next.ServeHTTP(w, r)
	})
}

type gzipResponseWriter struct {
	http.ResponseWriter
	writer  *gzip.Writer
	enabled bool
	wrote   bool
}

func (w *gzipResponseWriter) WriteHeader(status int) {
	if w.wrote {
		return
	}
	w.wrote = true
	contentType := w.Header().Get("Content-Type")
	compressible := strings.HasPrefix(contentType, "text/") ||
		strings.Contains(contentType, "javascript") ||
		strings.Contains(contentType, "json") ||
		strings.Contains(contentType, "xml") ||
		strings.Contains(contentType, "svg")
	if compressible && status != http.StatusNoContent && status != http.StatusNotModified {
		w.Header().Del("Content-Length")
		w.Header().Set("Content-Encoding", "gzip")
		w.writer = gzip.NewWriter(w.ResponseWriter)
		w.enabled = true
	}
	w.ResponseWriter.WriteHeader(status)
}

func (w *gzipResponseWriter) Write(content []byte) (int, error) {
	if !w.wrote {
		w.WriteHeader(http.StatusOK)
	}
	if w.enabled {
		return w.writer.Write(content)
	}
	return w.ResponseWriter.Write(content)
}

func gzipResponses(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Add("Vary", "Accept-Encoding")
		if r.Method == http.MethodHead || r.Header.Get("Range") != "" || !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			next.ServeHTTP(w, r)
			return
		}
		wrapped := &gzipResponseWriter{ResponseWriter: w}
		next.ServeHTTP(wrapped, r)
		if wrapped.writer != nil {
			_ = wrapped.writer.Close()
		}
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func apiError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, M{"error": message})
}
func methodNotAllowed(w http.ResponseWriter) {
	w.Header().Set("Allow", "GET, POST, PATCH, DELETE")
	apiError(w, http.StatusMethodNotAllowed, "Method not allowed")
}

func decodeBody(r *http.Request) (M, error) {
	defer r.Body.Close()
	decoder := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 2<<20))
	decoder.UseNumber()
	var value M
	if err := decoder.Decode(&value); err != nil {
		return nil, err
	}
	return value, nil
}

func mapValue(value any) M {
	if result, ok := value.(M); ok {
		return result
	}
	if result, ok := value.(map[string]interface{}); ok {
		return M(result)
	}
	return M{}
}
func stringValue(value any) string {
	if value == nil {
		return ""
	}
	if text, ok := value.(string); ok {
		return text
	}
	return fmt.Sprint(value)
}
func intValue(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int32:
		return int(typed)
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case json.Number:
		number, _ := typed.Int64()
		return int(number)
	case string:
		number, _ := strconv.Atoi(typed)
		return number
	default:
		return 0
	}
}
func floatValue(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case json.Number:
		number, _ := typed.Float64()
		return number
	case string:
		number, _ := strconv.ParseFloat(typed, 64)
		return number
	default:
		return 0
	}
}
func boolValue(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		result, _ := strconv.ParseBool(typed)
		return result
	case float64:
		return typed != 0
	default:
		return false
	}
}
func copyMap(source M) M {
	target := make(M, len(source))
	for key, value := range source {
		target[key] = value
	}
	return target
}
func requirePositiveID(value any) (int, error) {
	id := intValue(value)
	if id < 1 {
		return 0, errors.New("invalid id")
	}
	return id, nil
}
