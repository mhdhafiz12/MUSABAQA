package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/mail"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type apiFailure struct {
	status  int
	message string
}

func (e *apiFailure) Error() string { return e.message }

func fail(status int, message string) error { return &apiFailure{status: status, message: message} }

var (
	timePattern  = regexp.MustCompile(`^([01][0-9]|2[0-3]):[0-5][0-9]$`)
	colorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
	chessPattern = regexp.MustCompile(`^[A-Z0-9/_-]+$`)
)

func (a *application) handleAPI(w http.ResponseWriter, r *http.Request) {
	resource := r.URL.Query().Get("resource")
	if resource == "" {
		resource = "status"
	}

	if resource == "admin-session" {
		switch r.Method {
		case http.MethodGet:
			writeJSON(w, http.StatusOK, M{"data": M{"authenticated": a.authenticated(r)}})
		case http.MethodDelete:
			a.clearSession(w, r)
			writeJSON(w, http.StatusOK, M{"data": M{"authenticated": false}})
		default:
			methodNotAllowed(w)
		}
		return
	}
	if resource == "admin-login" {
		if r.Method != http.MethodPost {
			methodNotAllowed(w)
			return
		}
		input, err := decodeBody(r)
		if err != nil {
			apiError(w, http.StatusBadRequest, "Invalid JSON request")
			return
		}
		if !secureEqual(a.adminKey, stringValue(input["password"])) {
			apiError(w, http.StatusUnauthorized, "Invalid administrator password")
			return
		}
		if err := a.createSession(w, r); err != nil {
			apiError(w, http.StatusInternalServerError, "Could not start admin session")
			return
		}
		writeJSON(w, http.StatusOK, M{"data": M{"authenticated": true}})
		return
	}

	if r.Method == http.MethodGet {
		a.handleAPIGet(w, r, resource)
		return
	}
	if r.Method != http.MethodPost && r.Method != http.MethodPatch && r.Method != http.MethodDelete {
		methodNotAllowed(w)
		return
	}
	if resource == "reviews" && r.Method == http.MethodPost {
		a.createReview(w, r)
		return
	}
	if resource == "visitor-logs" && r.Method == http.MethodPost {
		a.createVisitorLog(w, r)
		return
	}
	if !a.authenticated(r) {
		apiError(w, http.StatusUnauthorized, "Your admin session has expired. Please sign in again.")
		return
	}

	var err error
	if resource == "team-image" && r.Method == http.MethodPost {
		err = a.uploadTeamImage(w, r)
	} else {
		input, decodeErr := decodeBody(r)
		if decodeErr != nil {
			apiError(w, http.StatusBadRequest, "Invalid JSON request")
			return
		}
		err = a.mutate(w, r.Context(), resource, r.Method, input)
	}
	if err == nil {
		return
	}
	if expected, ok := err.(*apiFailure); ok {
		apiError(w, expected.status, expected.message)
		return
	}
	logAPIError(resource, err)
	apiError(w, http.StatusInternalServerError, "Database operation failed")
}

func (a *application) handleAPIGet(w http.ResponseWriter, r *http.Request, resource string) {
	ctx := r.Context()
	var data any
	var err error
	switch resource {
	case "status":
		database := "demo"
		if a.store.connected() {
			database = "connected"
		}
		writeJSON(w, http.StatusOK, M{"ok": true, "database": database, "time": time.Now().UTC().Format(time.RFC3339)})
		return
	case "teams", "scoreboard":
		data, err = a.store.teams(ctx)
	case "schedule", "programs":
		data, err = a.store.schedule(ctx)
	case "participants":
		data, err = a.store.participants(ctx, strings.TrimSpace(r.URL.Query().Get("q")))
	case "student-directory":
		data, err = a.store.publicStudents(ctx)
	case "results":
		data, err = a.store.results(ctx)
	case "settings":
		data, err = a.store.settings(ctx)
	case "schedule-blocks":
		var settings M
		settings, err = a.store.settings(ctx)
		data = settings["schedule_blocks"]
	case "students":
		if !a.authenticated(r) {
			apiError(w, http.StatusUnauthorized, "Your admin session has expired. Please sign in again.")
			return
		}
		data, err = a.store.students(ctx)
	case "reviews":
		if !a.authenticated(r) {
			apiError(w, http.StatusUnauthorized, "Your admin session has expired. Please sign in again.")
			return
		}
		data, err = a.store.reviews(ctx)
	case "visitor-logs":
		if !a.authenticated(r) {
			apiError(w, http.StatusUnauthorized, "Your admin session has expired. Please sign in again.")
			return
		}
		data, err = a.store.visitorLogs(ctx)
	default:
		apiError(w, http.StatusNotFound, "Unknown resource")
		return
	}
	if err != nil {
		logAPIError(resource, err)
		apiError(w, http.StatusInternalServerError, "Could not load data")
		return
	}
	writeJSON(w, http.StatusOK, M{"data": data})
}

func (a *application) createReview(w http.ResponseWriter, r *http.Request) {
	settings, err := a.store.settings(r.Context())
	if err != nil {
		apiError(w, http.StatusInternalServerError, "Your review could not be saved. Please try again.")
		return
	}
	if !boolValue(settings["reviews_enabled"]) {
		apiError(w, http.StatusForbidden, "New reviews are currently paused.")
		return
	}
	input, err := decodeBody(r)
	if err != nil {
		apiError(w, http.StatusBadRequest, "Invalid JSON request")
		return
	}
	name, message, rating := strings.TrimSpace(stringValue(input["name"])), strings.TrimSpace(stringValue(input["message"])), intValue(input["rating"])
	if name == "" || len(name) > 100 {
		apiError(w, http.StatusUnprocessableEntity, "Please enter a name of 100 characters or fewer.")
		return
	}
	if rating < 1 || rating > 5 {
		apiError(w, http.StatusUnprocessableEntity, "Please select a rating from 1 to 5.")
		return
	}
	if message == "" || len(message) > 2000 {
		apiError(w, http.StatusUnprocessableEntity, "Please enter a review of 2,000 characters or fewer.")
		return
	}
	var review M
	if a.store.db != nil {
		review, err = queryOne(r.Context(), a.store.db, "INSERT INTO reviews (name,rating,message) VALUES ($1,$2,$3) RETURNING id,name,rating,message,created_at", name, rating, message)
	} else {
		result, updateErr := a.store.updateRuntime(func(data M) (any, error) {
			reviews := sliceMaps(data["reviews"])
			review = M{"id": nextID(reviews), "name": name, "rating": rating, "message": message, "created_at": time.Now().UTC().Format(time.RFC3339)}
			data["reviews"] = append(reviews, review)
			return review, nil
		})
		err = updateErr
		if record, ok := result.(M); ok {
			review = record
		}
	}
	if err != nil {
		logAPIError("reviews", err)
		apiError(w, http.StatusInternalServerError, "Your review could not be saved. Please try again.")
		return
	}
	writeJSON(w, http.StatusCreated, M{"data": review})
}

func (a *application) createVisitorLog(w http.ResponseWriter, r *http.Request) {
	input, err := decodeBody(r)
	if err != nil {
		apiError(w, http.StatusBadRequest, "Invalid JSON request")
		return
	}
	name := strings.TrimSpace(stringValue(input["name"]))
	if name == "" || len(name) > 255 {
		apiError(w, http.StatusUnprocessableEntity, "Please enter a valid name.")
		return
	}
	var logEntry M
	if a.store.db != nil {
		logEntry, err = queryOne(r.Context(), a.store.db, "INSERT INTO visitor_logs (name) VALUES ($1) RETURNING id,name,created_at", name)
	}
	if a.store.db == nil || err != nil {
		result, updateErr := a.store.updateRuntime(func(data M) (any, error) {
			logs := sliceMaps(data["visitor_logs"])
			logEntry = M{"id": nextID(logs), "name": name, "created_at": time.Now().UTC().Format(time.RFC3339)}
			data["visitor_logs"] = append(logs, logEntry)
			return logEntry, nil
		})
		err = updateErr
		if record, ok := result.(M); ok {
			logEntry = record
		}
	}
	if err != nil {
		logAPIError("visitor-logs", err)
		apiError(w, http.StatusInternalServerError, "Could not save visitor log.")
		return
	}
	writeJSON(w, http.StatusCreated, M{"data": logEntry})
}

func (a *application) mutate(w http.ResponseWriter, ctx context.Context, resource, method string, input M) error {
	switch resource {
	case "scores":
		return a.mutateScore(w, ctx, input)
	case "teams":
		return a.mutateTeam(w, ctx, method, input)
	case "schedule-blocks":
		return a.mutateScheduleBlock(w, ctx, method, input)
	case "settings":
		return a.mutateSettings(w, ctx, method, input)
	case "program-status":
		return a.mutateProgramStatus(w, ctx, input)
	case "programs":
		return a.mutateProgram(w, ctx, method, input)
	case "participants":
		return a.mutateParticipant(w, ctx, method, input)
	case "students":
		return a.mutateStudent(w, ctx, method, input)
	case "reviews":
		return a.deleteReview(w, ctx, method, input)
	case "results":
		return a.mutateResult(w, ctx, method, input)
	default:
		return fail(http.StatusNotFound, "Unknown resource")
	}
}

func (a *application) mutateScore(w http.ResponseWriter, ctx context.Context, input M) error {
	id, score := intValue(input["team_id"]), floatValue(input["score"])
	if id < 1 || score < 0 {
		return fail(http.StatusUnprocessableEntity, "Valid team_id and score are required")
	}
	var record M
	var err error
	if a.store.db != nil {
		record, err = queryOne(ctx, a.store.db, "UPDATE teams SET score=$1,updated_at=now() WHERE id=$2 RETURNING id,slug,name,score,color", score, id)
	} else {
		result, updateErr := a.store.updateRuntime(func(data M) (any, error) {
			teams := sliceMaps(data["teams"])
			for _, team := range teams {
				if intValue(team["id"]) == id {
					team["score"] = score
					data["teams"] = teams
					return team, nil
				}
			}
			return nil, fail(http.StatusNotFound, "Team not found")
		})
		err = updateErr
		record, _ = result.(M)
	}
	if err != nil {
		return databaseOrNotFound(err, "Team not found")
	}
	writeJSON(w, http.StatusOK, M{"data": record})
	return nil
}

func (a *application) mutateTeam(w http.ResponseWriter, ctx context.Context, method string, input M) error {
	if method != http.MethodPatch {
		return fail(http.StatusMethodNotAllowed, "Method not allowed")
	}
	id, name, color := intValue(input["id"]), strings.TrimSpace(stringValue(input["name"])), strings.TrimSpace(stringValue(input["color"]))
	if id < 1 || name == "" || len(name) > 80 {
		return fail(http.StatusUnprocessableEntity, "A valid team and name are required")
	}
	if !colorPattern.MatchString(color) {
		return fail(http.StatusUnprocessableEntity, "Team color must be a valid six-digit hex color")
	}
	var record M
	var err error
	if a.store.db != nil {
		record, err = queryOne(ctx, a.store.db, "UPDATE teams SET name=$1,color=$2,updated_at=now() WHERE id=$3 RETURNING id,slug,name,score,color", name, color, id)
	} else {
		result, updateErr := a.store.updateRuntime(func(data M) (any, error) {
			teams := sliceMaps(data["teams"])
			for _, team := range teams {
				if intValue(team["id"]) == id {
					team["name"], team["color"] = name, color
					data["teams"] = teams
					return team, nil
				}
			}
			return nil, fail(http.StatusNotFound, "Team not found")
		})
		err = updateErr
		record, _ = result.(M)
	}
	if err != nil {
		return databaseOrNotFound(err, "Team not found")
	}
	writeJSON(w, http.StatusOK, M{"data": record})
	return nil
}

func (a *application) mutateScheduleBlock(w http.ResponseWriter, ctx context.Context, method string, input M) error {
	if method != http.MethodPatch {
		return fail(http.StatusMethodNotAllowed, "Method not allowed")
	}
	key, start, end := stringValue(input["key"]), stringValue(input["start_time"]), stringValue(input["end_time"])
	if !timePattern.MatchString(start) || !timePattern.MatchString(end) || start >= end {
		return fail(http.StatusUnprocessableEntity, "Enter a valid start time before the end time")
	}
	settings, err := a.store.settings(ctx)
	if err != nil {
		return err
	}
	blocks := sliceMaps(settings["schedule_blocks"])
	found := false
	for _, block := range blocks {
		if stringValue(block["key"]) == key {
			block["start_time"], block["end_time"], found = start, end, true
		}
	}
	if !found {
		return fail(http.StatusNotFound, "Schedule block not found")
	}
	if a.store.db != nil {
		encoded, _ := json.Marshal(blocks)
		_, err = a.store.db.Exec(ctx, "UPDATE site_settings SET schedule_blocks=$1::jsonb,updated_at=now() WHERE id=1", encoded)
		if err != nil {
			return err
		}
	}
	_, err = a.store.updateRuntime(func(data M) (any, error) {
		merged := normalizeSettings(mapValue(data["settings"]))
		merged["schedule_blocks"] = blocks
		data["settings"] = merged
		return blocks, nil
	})
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, M{"data": blocks})
	return nil
}

func (a *application) mutateSettings(w http.ResponseWriter, ctx context.Context, method string, input M) error {
	if method != http.MethodPatch {
		return fail(http.StatusMethodNotAllowed, "Method not allowed")
	}
	name, date, video := strings.TrimSpace(stringValue(input["festival_name"])), stringValue(input["festival_date"]), strings.TrimSpace(stringValue(input["intro_video_url"]))
	darkness := intValue(input["video_darkness"])
	if name == "" || len(name) > 120 {
		return fail(http.StatusUnprocessableEntity, "Festival name must be 1 to 120 characters")
	}
	if parsed, err := time.Parse("2006-01-02", date); err != nil || parsed.Format("2006-01-02") != date {
		return fail(http.StatusUnprocessableEntity, "A valid festival date is required")
	}
	if video == "" || len(video) > 500 {
		return fail(http.StatusUnprocessableEntity, "Video path must be 1 to 500 characters")
	}
	if darkness < 0 || darkness > 75 {
		return fail(http.StatusUnprocessableEntity, "Video darkness must be between 0 and 75")
	}
	contact := truncate(strings.TrimSpace(stringValue(input["contact_email"])), 160)
	if contact != "" {
		if _, err := mail.ParseAddress(contact); err != nil {
			return fail(http.StatusUnprocessableEntity, "Enter a valid contact email address")
		}
	}
	updates := M{"festival_name": name, "festival_date": date, "intro_video_enabled": boolValue(input["intro_video_enabled"]), "intro_video_url": video, "intro_video_loop": boolValue(input["intro_video_loop"]), "video_darkness": darkness, "animations_enabled": boolValue(input["animations_enabled"]), "scoreboard_live": boolValue(input["scoreboard_live"]), "announcement_enabled": boolValue(input["announcement_enabled"]), "announcement_text": truncate(strings.TrimSpace(stringValue(input["announcement_text"])), 240), "schedule_visible": boolDefault(input, "schedule_visible", true), "participants_visible": boolDefault(input, "participants_visible", true), "reviews_enabled": boolDefault(input, "reviews_enabled", true), "venue_name": truncate(strings.TrimSpace(stringValue(input["venue_name"])), 140), "contact_email": contact}
	if a.store.db != nil {
		_, err := a.store.db.Exec(ctx, `INSERT INTO site_settings (id,festival_name,festival_date,intro_video_enabled,intro_video_url,intro_video_loop,video_darkness,animations_enabled,scoreboard_live,updated_at) VALUES (1,$1,$2,$3,$4,$5,$6,$7,$8,now()) ON CONFLICT (id) DO UPDATE SET festival_name=excluded.festival_name,festival_date=excluded.festival_date,intro_video_enabled=excluded.intro_video_enabled,intro_video_url=excluded.intro_video_url,intro_video_loop=excluded.intro_video_loop,video_darkness=excluded.video_darkness,animations_enabled=excluded.animations_enabled,scoreboard_live=excluded.scoreboard_live,updated_at=now()`, name, date, updates["intro_video_enabled"], video, updates["intro_video_loop"], darkness, updates["animations_enabled"], updates["scoreboard_live"])
		if err != nil {
			return err
		}
	}
	result, err := a.store.updateRuntime(func(data M) (any, error) {
		settings := normalizeSettings(mapValue(data["settings"]))
		for key, value := range updates {
			settings[key] = value
		}
		data["settings"] = settings
		return settings, nil
	})
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, M{"data": result})
	return nil
}

func (a *application) mutateProgramStatus(w http.ResponseWriter, ctx context.Context, input M) error {
	id, status := intValue(input["program_id"]), stringValue(input["status"])
	if id < 1 || !oneOf(status, "upcoming", "live", "completed") {
		return fail(http.StatusUnprocessableEntity, "Valid program_id and status are required")
	}
	if a.store.db != nil {
		tx, err := a.store.db.Begin(ctx)
		if err != nil {
			return err
		}
		defer tx.Rollback(ctx)
		if status == "live" {
			if _, err = tx.Exec(ctx, "UPDATE programs SET status='upcoming',updated_at=now() WHERE status='live'"); err != nil {
				return err
			}
		}
		records, err := queryMaps(ctx, tx, "UPDATE programs SET status=$1,updated_at=now() WHERE id=$2 RETURNING id,title,status", status, id)
		if err != nil {
			return err
		}
		if len(records) == 0 {
			return fail(http.StatusNotFound, "Program not found")
		}
		if err = tx.Commit(ctx); err != nil {
			return err
		}
		writeJSON(w, http.StatusOK, M{"data": records[0]})
		return nil
	}
	result, err := a.store.updateRuntime(func(data M) (any, error) {
		programs := sliceMaps(data["schedule"])
		var record M
		for _, program := range programs {
			if status == "live" && stringValue(program["status"]) == "live" {
				program["status"] = "upcoming"
			}
			if intValue(program["id"]) == id {
				program["status"] = status
				record = program
			}
		}
		if record == nil {
			return nil, fail(http.StatusNotFound, "Program not found")
		}
		data["schedule"] = programs
		return record, nil
	})
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, M{"data": result})
	return nil
}

func (a *application) mutateProgram(w http.ResponseWriter, ctx context.Context, method string, input M) error {
	if method == http.MethodDelete {
		return a.deleteRecord(w, ctx, "programs", "schedule", input, "Program")
	}
	if method != http.MethodPost && method != http.MethodPatch {
		return fail(http.StatusMethodNotAllowed, "Method not allowed")
	}
	program, err := a.validProgram(ctx, input)
	if err != nil {
		return err
	}
	id := intValue(input["id"])
	var record M
	if a.store.db != nil {
		if method == http.MethodPost {
			record, err = queryOne(ctx, a.store.db, "INSERT INTO programs (title,category,session,start_time,duration_minutes,venue,status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id,title,category,session,to_char(start_time,'HH24:MI') AS start_time,duration_minutes,venue,status", program["title"], program["category"], program["session"], program["start_time"], program["duration_minutes"], program["venue"], program["status"])
		} else {
			if id < 1 {
				return fail(http.StatusUnprocessableEntity, "Valid program id is required")
			}
			record, err = queryOne(ctx, a.store.db, "UPDATE programs SET title=$1,category=$2,session=$3,start_time=$4,duration_minutes=$5,venue=$6,status=$7,updated_at=now() WHERE id=$8 RETURNING id,title,category,session,to_char(start_time,'HH24:MI') AS start_time,duration_minutes,venue,status", program["title"], program["category"], program["session"], program["start_time"], program["duration_minutes"], program["venue"], program["status"], id)
		}
	} else {
		result, updateErr := a.store.updateRuntime(func(data M) (any, error) {
			items := sliceMaps(data["schedule"])
			if method == http.MethodPost {
				program["id"] = nextID(items)
				items = append(items, program)
			} else {
				if id < 1 {
					return nil, fail(http.StatusUnprocessableEntity, "Valid program id is required")
				}
				found := false
				program["id"] = id
				for index, item := range items {
					if intValue(item["id"]) == id {
						items[index], found = program, true
					}
				}
				if !found {
					return nil, fail(http.StatusNotFound, "Program not found")
				}
			}
			data["schedule"] = items
			return program, nil
		})
		err = updateErr
		record, _ = result.(M)
	}
	if err != nil {
		return databaseOrNotFound(err, "Program not found")
	}
	status := http.StatusOK
	if method == http.MethodPost {
		status = http.StatusCreated
	}
	writeJSON(w, status, M{"data": record})
	return nil
}

func (a *application) validProgram(ctx context.Context, input M) (M, error) {
	for _, field := range []string{"title", "category", "session", "start_time", "duration_minutes", "venue", "status"} {
		if strings.TrimSpace(stringValue(input[field])) == "" {
			return nil, fail(http.StatusUnprocessableEntity, field+" is required")
		}
	}
	settings, err := a.store.settings(ctx)
	if err != nil {
		return nil, err
	}
	session, start, status, duration := stringValue(input["session"]), stringValue(input["start_time"]), stringValue(input["status"]), intValue(input["duration_minutes"])
	if !timePattern.MatchString(start) {
		return nil, fail(http.StatusUnprocessableEntity, "Invalid start time")
	}
	if duration < 1 {
		return nil, fail(http.StatusUnprocessableEntity, "Duration must be at least one minute")
	}
	if !oneOf(status, "upcoming", "live", "completed") {
		return nil, fail(http.StatusUnprocessableEntity, "Invalid status")
	}
	var minimum, maximum string
	for _, block := range sliceMaps(settings["schedule_blocks"]) {
		if stringValue(block["key"]) == session {
			minimum, maximum = stringValue(block["start_time"]), stringValue(block["end_time"])
		}
	}
	if minimum == "" {
		return nil, fail(http.StatusUnprocessableEntity, "Invalid schedule block")
	}
	if start < minimum || start > maximum {
		return nil, fail(http.StatusUnprocessableEntity, "Start time is outside the selected schedule block")
	}
	if timeMinutes(start)+duration > timeMinutes(maximum) {
		return nil, fail(http.StatusUnprocessableEntity, "Program duration extends beyond the selected schedule block")
	}
	return M{"title": strings.TrimSpace(stringValue(input["title"])), "category": strings.TrimSpace(stringValue(input["category"])), "session": session, "start_time": start, "duration_minutes": duration, "venue": strings.TrimSpace(stringValue(input["venue"])), "status": status}, nil
}

func (a *application) mutateParticipant(w http.ResponseWriter, ctx context.Context, method string, input M) error {
	if method == http.MethodDelete {
		return a.deleteRecord(w, ctx, "participants", "participants", input, "Participant")
	}
	if method != http.MethodPost && method != http.MethodPatch {
		return fail(http.StatusMethodNotAllowed, "Method not allowed")
	}
	participant, err := validParticipant(input)
	if err != nil {
		return err
	}
	id := intValue(input["id"])
	var record M
	if a.store.db != nil {
		if method == http.MethodPost {
			record, err = queryOne(ctx, a.store.db, "INSERT INTO participants (name,code,team_id,program_id,category,reporting_time) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,name,code,team_id,program_id,category,to_char(reporting_time,'HH24:MI') AS reporting_time", participant["name"], participant["code"], participant["team_id"], participant["program_id"], participant["category"], participant["reporting_time"])
		} else {
			if id < 1 {
				return fail(http.StatusUnprocessableEntity, "Valid participant id is required")
			}
			record, err = queryOne(ctx, a.store.db, "UPDATE participants SET name=$1,code=$2,team_id=$3,program_id=$4,category=$5,reporting_time=$6 WHERE id=$7 RETURNING id,name,code,team_id,program_id,category,to_char(reporting_time,'HH24:MI') AS reporting_time", participant["name"], participant["code"], participant["team_id"], participant["program_id"], participant["category"], participant["reporting_time"], id)
		}
	} else {
		result, updateErr := a.store.updateRuntime(func(data M) (any, error) {
			items := sliceMaps(data["participants"])
			if method == http.MethodPost {
				participant["id"] = nextID(items)
				items = append(items, participant)
			} else {
				if id < 1 {
					return nil, fail(http.StatusUnprocessableEntity, "Valid participant id is required")
				}
				found := false
				participant["id"] = id
				for index, item := range items {
					if intValue(item["id"]) == id {
						items[index], found = participant, true
					}
				}
				if !found {
					return nil, fail(http.StatusNotFound, "Participant not found")
				}
			}
			data["participants"] = items
			return participant, nil
		})
		err = updateErr
		record, _ = result.(M)
	}
	if err != nil {
		return databaseOrNotFound(err, "Participant not found")
	}
	status := http.StatusOK
	if method == http.MethodPost {
		status = http.StatusCreated
	}
	writeJSON(w, status, M{"data": record})
	return nil
}

func validParticipant(input M) (M, error) {
	for _, field := range []string{"name", "code", "team_id", "program_id", "category", "reporting_time"} {
		if strings.TrimSpace(stringValue(input[field])) == "" {
			return nil, fail(http.StatusUnprocessableEntity, field+" is required")
		}
	}
	teamID, programID, reporting := intValue(input["team_id"]), intValue(input["program_id"]), stringValue(input["reporting_time"])
	if teamID < 1 || programID < 1 {
		return nil, fail(http.StatusUnprocessableEntity, "Valid team and program are required")
	}
	if !timePattern.MatchString(reporting) {
		return nil, fail(http.StatusUnprocessableEntity, "Invalid reporting time")
	}
	return M{"name": strings.TrimSpace(stringValue(input["name"])), "code": strings.ToUpper(strings.TrimSpace(stringValue(input["code"]))), "team_id": teamID, "program_id": programID, "category": strings.TrimSpace(stringValue(input["category"])), "reporting_time": reporting}, nil
}

func (a *application) deleteReview(w http.ResponseWriter, ctx context.Context, method string, input M) error {
	if method != http.MethodDelete {
		return fail(http.StatusMethodNotAllowed, "Method not allowed")
	}
	return a.deleteRecord(w, ctx, "reviews", "reviews", input, "Review")
}

func (a *application) deleteRecord(w http.ResponseWriter, ctx context.Context, table, runtimeKey string, input M, label string) error {
	id := intValue(input["id"])
	if id < 1 {
		return fail(http.StatusUnprocessableEntity, "Valid "+strings.ToLower(label)+" id is required")
	}
	if a.store.db != nil && (table != "students" || a.store.databaseHasStudents(ctx)) {
		databaseTable := table
		if table == "students" {
			databaseTable = "college_students"
		}
		records, err := queryMaps(ctx, a.store.db, "DELETE FROM "+databaseTable+" WHERE id=$1 RETURNING id", id)
		if err != nil {
			return err
		}
		if len(records) == 0 {
			return fail(http.StatusNotFound, label+" not found")
		}
	} else {
		_, err := a.store.updateRuntime(func(data M) (any, error) {
			items := sliceMaps(data[runtimeKey])
			filtered := make([]M, 0, len(items))
			found := false
			for _, item := range items {
				if intValue(item["id"]) == id {
					found = true
				} else {
					filtered = append(filtered, item)
				}
			}
			if !found {
				return nil, fail(http.StatusNotFound, label+" not found")
			}
			data[runtimeKey] = filtered
			return nil, nil
		})
		if err != nil {
			return err
		}
	}
	writeJSON(w, http.StatusOK, M{"data": M{"id": id}})
	return nil
}

func (a *application) mutateStudent(w http.ResponseWriter, ctx context.Context, method string, input M) error {
	if method == http.MethodDelete {
		return a.deleteRecord(w, ctx, "students", "students", input, "Student")
	}
	if method != http.MethodPost && method != http.MethodPatch {
		return fail(http.StatusMethodNotAllowed, "Method not allowed")
	}
	student, err := validStudent(input)
	if err != nil {
		return err
	}
	id := intValue(input["id"])
	var record M
	databaseReady := a.store.databaseHasStudents(ctx)
	fields := []string{"source_id", "full_name", "display_name", "name_arabic", "place", "admission_no", "class_id", "maddhab_id", "phone", "email", "dob", "guardian_name", "guardian_phone", "status", "chess_number"}
	values := make([]any, len(fields))
	for index, field := range fields {
		values[index] = student[field]
	}
	if databaseReady {
		if method == http.MethodPost {
			record, err = queryOne(ctx, a.store.db, `INSERT INTO college_students (source_id,full_name,display_name,name_arabic,place,admission_no,class_id,maddhab_id,phone,email,dob,guardian_name,guardian_phone,status,chess_number) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id,source_id,full_name,display_name,name_arabic,place,admission_no,class_id,maddhab_id,phone,email,dob::text,guardian_name,guardian_phone,status,chess_number`, values...)
		} else {
			if id < 1 {
				return fail(http.StatusUnprocessableEntity, "Valid student id is required")
			}
			values = append(values, id)
			record, err = queryOne(ctx, a.store.db, `UPDATE college_students SET source_id=$1,full_name=$2,display_name=$3,name_arabic=$4,place=$5,admission_no=$6,class_id=$7,maddhab_id=$8,phone=$9,email=$10,dob=$11,guardian_name=$12,guardian_phone=$13,status=$14,chess_number=$15,updated_at=now() WHERE id=$16 RETURNING id,source_id,full_name,display_name,name_arabic,place,admission_no,class_id,maddhab_id,phone,email,dob::text,guardian_name,guardian_phone,status,chess_number`, values...)
		}
	} else {
		result, updateErr := a.store.updateRuntime(func(data M) (any, error) {
			items := sliceMaps(data["students"])
			for _, item := range items {
				if strings.EqualFold(stringValue(item["chess_number"]), stringValue(student["chess_number"])) && (id < 1 || intValue(item["id"]) != id) {
					return nil, fail(http.StatusConflict, "That chess number is already assigned")
				}
			}
			if method == http.MethodPost {
				student["id"] = nextID(items)
				items = append(items, student)
			} else {
				if id < 1 {
					return nil, fail(http.StatusUnprocessableEntity, "Valid student id is required")
				}
				found := false
				student["id"] = id
				for index, item := range items {
					if intValue(item["id"]) == id {
						items[index], found = student, true
					}
				}
				if !found {
					return nil, fail(http.StatusNotFound, "Student not found")
				}
			}
			data["students"] = items
			return student, nil
		})
		err = updateErr
		record, _ = result.(M)
	}
	if err != nil {
		return databaseOrNotFound(err, "Student not found")
	}
	status := http.StatusOK
	if method == http.MethodPost {
		status = http.StatusCreated
	}
	writeJSON(w, status, M{"data": record})
	return nil
}

func validStudent(input M) (M, error) {
	fullName, chess, status := strings.TrimSpace(stringValue(input["full_name"])), strings.ToUpper(strings.TrimSpace(stringValue(input["chess_number"]))), stringValue(input["status"])
	if status == "" {
		status = "active"
	}
	if fullName == "" || len(fullName) > 200 {
		return nil, fail(http.StatusUnprocessableEntity, "Full name must be between 1 and 200 characters")
	}
	if chess == "" || len(chess) > 50 {
		return nil, fail(http.StatusUnprocessableEntity, "Chess number must be between 1 and 50 characters")
	}
	if !chessPattern.MatchString(chess) {
		return nil, fail(http.StatusUnprocessableEntity, "Chess number may contain letters, numbers, hyphens, slashes and underscores")
	}
	if !oneOf(status, "active", "graduated", "left", "inactive") {
		return nil, fail(http.StatusUnprocessableEntity, "Invalid student status")
	}
	email := strings.TrimSpace(stringValue(input["email"]))
	if email != "" {
		if _, err := mail.ParseAddress(email); err != nil {
			return nil, fail(http.StatusUnprocessableEntity, "Enter a valid student email")
		}
	}
	var dob any
	if value := strings.TrimSpace(stringValue(input["dob"])); value != "" {
		if parsed, err := time.Parse("2006-01-02", value); err != nil || parsed.Format("2006-01-02") != value {
			return nil, fail(http.StatusUnprocessableEntity, "Enter a valid date of birth")
		}
		dob = value
	}
	return M{"source_id": nullablePositiveInt(input["source_id"]), "full_name": fullName, "display_name": truncate(strings.TrimSpace(stringValue(input["display_name"])), 150), "name_arabic": truncate(strings.TrimSpace(stringValue(input["name_arabic"])), 200), "place": truncate(strings.TrimSpace(stringValue(input["place"])), 100), "admission_no": truncate(strings.TrimSpace(stringValue(input["admission_no"])), 50), "class_id": nullablePositiveInt(input["class_id"]), "maddhab_id": nullablePositiveInt(input["maddhab_id"]), "phone": truncate(strings.TrimSpace(stringValue(input["phone"])), 30), "email": email, "dob": dob, "guardian_name": truncate(strings.TrimSpace(stringValue(input["guardian_name"])), 200), "guardian_phone": truncate(strings.TrimSpace(stringValue(input["guardian_phone"])), 30), "status": status, "chess_number": chess}, nil
}

func (a *application) mutateResult(w http.ResponseWriter, ctx context.Context, method string, input M) error {
	if method != http.MethodPost {
		return fail(http.StatusMethodNotAllowed, "Method not allowed")
	}
	programID, participantID, position := intValue(input["program_id"]), intValue(input["participant_id"]), intValue(input["position"])
	if programID < 1 || participantID < 1 || position < 1 {
		return fail(http.StatusUnprocessableEntity, "program_id, participant_id, score and position are required")
	}
	if a.store.db == nil {
		return fail(http.StatusServiceUnavailable, "Publishing results requires PostgreSQL")
	}
	published := boolDefault(input, "is_published", true)
	record, err := queryOne(ctx, a.store.db, `INSERT INTO results (program_id,participant_id,score,position,is_published,published_at) VALUES ($1,$2,$3,$4,$5,CASE WHEN $5 THEN now() ELSE NULL END) ON CONFLICT (program_id,participant_id) DO UPDATE SET score=excluded.score,position=excluded.position,is_published=excluded.is_published,published_at=CASE WHEN excluded.is_published THEN now() ELSE results.published_at END RETURNING *`, programID, participantID, floatValue(input["score"]), position, published)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusCreated, M{"data": record})
	return nil
}

func (a *application) uploadTeamImage(w http.ResponseWriter, r *http.Request) error {
	r.Body = http.MaxBytesReader(w, r.Body, 4<<20)
	if err := r.ParseMultipartForm(3 << 20); err != nil {
		return fail(http.StatusUnprocessableEntity, "Team images must be smaller than 3 MB")
	}
	id := intValue(r.FormValue("team_id"))
	file, header, err := r.FormFile("image")
	if err != nil || id < 1 {
		return fail(http.StatusUnprocessableEntity, "Choose a team and image to upload")
	}
	defer file.Close()
	if header.Size > 3<<20 {
		return fail(http.StatusUnprocessableEntity, "Team images must be smaller than 3 MB")
	}
	extension, err := imageExtension(file)
	if err != nil {
		return err
	}
	teams, err := a.store.teams(r.Context())
	if err != nil {
		return err
	}
	var team M
	for _, candidate := range teams {
		if intValue(candidate["id"]) == id {
			team = candidate
			break
		}
	}
	if team == nil {
		return fail(http.StatusNotFound, "Team not found")
	}
	directory := filepath.Join(a.root, "assets", "uploads")
	if err := os.MkdirAll(directory, 0o775); err != nil {
		return err
	}
	random := make([]byte, 6)
	if _, err := rand.Read(random); err != nil {
		return err
	}
	filename := fmt.Sprintf("team-%d-%x.%s", id, random, extension)
	destination, err := os.OpenFile(filepath.Join(directory, filename), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(destination, file)
	closeErr := destination.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	path := "assets/uploads/" + filename
	_, err = a.store.updateRuntime(func(data M) (any, error) {
		profiles := mapValue(data["team_profiles"])
		profiles[fmt.Sprint(id)] = path
		data["team_profiles"] = profiles
		return nil, nil
	})
	if err != nil {
		return err
	}
	team["profile_image"] = path
	writeJSON(w, http.StatusCreated, M{"data": team})
	return nil
}

func imageExtension(file multipart.File) (string, error) {
	header := make([]byte, 512)
	count, err := file.Read(header)
	if err != nil && err != io.EOF {
		return "", err
	}
	if _, err = file.Seek(0, io.SeekStart); err != nil {
		return "", err
	}
	switch http.DetectContentType(header[:count]) {
	case "image/jpeg":
		return "jpg", nil
	case "image/png":
		return "png", nil
	case "image/webp":
		return "webp", nil
	default:
		return "", fail(http.StatusUnprocessableEntity, "Upload a JPG, PNG or WebP image")
	}
}

func nextID(items []M) int {
	maximum := 0
	for _, item := range items {
		if id := intValue(item["id"]); id > maximum {
			maximum = id
		}
	}
	return maximum + 1
}
func oneOf(value string, allowed ...string) bool {
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}
	return false
}
func truncate(value string, maximum int) string {
	runes := []rune(value)
	if len(runes) > maximum {
		return string(runes[:maximum])
	}
	return value
}
func nullablePositiveInt(value any) any {
	if number := intValue(value); number > 0 {
		return number
	}
	return nil
}
func boolDefault(input M, key string, fallback bool) bool {
	value, exists := input[key]
	if !exists || value == nil {
		return fallback
	}
	return boolValue(value)
}
func timeMinutes(value string) int {
	parsed, _ := time.Parse("15:04", value)
	return parsed.Hour()*60 + parsed.Minute()
}
func databaseOrNotFound(err error, message string) error {
	if err == nil {
		return nil
	}
	if strings.Contains(strings.ToLower(err.Error()), "no rows") {
		return fail(http.StatusNotFound, message)
	}
	return err
}
func logAPIError(resource string, err error) { fmt.Fprintf(os.Stderr, "api %s: %v\n", resource, err) }
