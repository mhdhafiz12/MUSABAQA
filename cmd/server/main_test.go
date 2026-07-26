package main

import (
	"compress/gzip"
	"encoding/json"
	"html/template"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestGzipResponses(t *testing.T) {
	handler := gzipResponses(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, M{"data": strings.Repeat("festival", 200)})
	}))
	request := httptest.NewRequest(http.MethodGet, "/api?resource=status", nil)
	request.Header.Set("Accept-Encoding", "gzip")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)

	if encoding := recorder.Header().Get("Content-Encoding"); encoding != "gzip" {
		t.Fatalf("Content-Encoding = %q; want gzip", encoding)
	}
	reader, err := gzip.NewReader(recorder.Body)
	if err != nil {
		t.Fatal(err)
	}
	decompressed, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	if !json.Valid(decompressed) {
		t.Fatalf("compressed response did not contain valid JSON: %q", decompressed)
	}
}

func TestHomeBootstrapSkipsPageSpecificCollections(t *testing.T) {
	root, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		t.Fatal(err)
	}
	pageTemplate, err := template.ParseFiles(filepath.Join(root, "web", "index.html"))
	if err != nil {
		t.Fatal(err)
	}
	app := &application{
		root: root, adminKey: "test", template: pageTemplate,
		store: newStore(root, nil), sessions: make(map[string]time.Time),
	}
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	recorder := httptest.NewRecorder()
	app.handlePage(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("home status = %d; want 200", recorder.Code)
	}
	body := recorder.Body.String()
	start := strings.Index(body, `<script id="initial-data" type="application/json">`)
	if start < 0 {
		t.Fatal("initial data script was not rendered")
	}
	start += len(`<script id="initial-data" type="application/json">`)
	end := strings.Index(body[start:], "</script>")
	if end < 0 {
		t.Fatal("initial data script was not closed")
	}
	var initial M
	if err := json.Unmarshal([]byte(body[start:start+end]), &initial); err != nil {
		t.Fatal(err)
	}
	if len(sliceMaps(initial["participants"])) != 0 || len(sliceMaps(initial["schedule"])) != 0 || len(sliceMaps(initial["teams"])) != 0 {
		t.Fatal("home bootstrap included page-specific collections")
	}
}
