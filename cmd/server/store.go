package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type store struct {
	path string
	db   *pgxpool.Pool
	mu   sync.RWMutex
}

var defaultBlocks = []M{
	{"key": "subahi", "label": "Subahi", "start_time": "05:00", "end_time": "07:00"},
	{"key": "morning", "label": "Morning", "start_time": "09:00", "end_time": "12:45"},
	{"key": "afternoon", "label": "Afternoon", "start_time": "14:30", "end_time": "16:30"},
	{"key": "evening", "label": "Evening", "start_time": "19:30", "end_time": "20:45"},
	{"key": "night", "label": "Night", "start_time": "21:30", "end_time": "23:00"},
}

var defaultSettings = M{
	"festival_name": "Kauzariyya Arts Festival 2026", "festival_date": "2026-07-05",
	"intro_video_enabled": true, "intro_video_url": "assets/intro.mp4", "intro_video_loop": false,
	"video_darkness": 38, "animations_enabled": true, "scoreboard_live": true,
	"announcement_enabled": false, "announcement_text": "Welcome to the Kauzariyya Arts Festival.",
	"schedule_visible": true, "participants_visible": true, "reviews_enabled": true,
	"venue_name": "Al Jamiathul Kauzariyya Campus", "contact_email": "", "schedule_blocks": defaultBlocks,
}

func newStore(root string, db *pgxpool.Pool) *store {
	return &store{path: filepath.Join(root, "database", "runtime-data.json"), db: db}
}

func (s *store) connected() bool { return s.db != nil }

func (s *store) readRuntime() (M, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.readRuntimeUnlocked()
}

func (s *store) readRuntimeUnlocked() (M, error) {
	content, err := os.ReadFile(s.path)
	if err != nil {
		return nil, err
	}
	decoder := json.NewDecoder(strings.NewReader(string(content)))
	decoder.UseNumber()
	var data M
	if err := decoder.Decode(&data); err != nil {
		return nil, err
	}
	for _, key := range []string{"teams", "schedule", "participants", "students", "reviews", "visitor_logs"} {
		if _, exists := data[key]; !exists {
			data[key] = []any{}
		}
	}
	if _, exists := data["settings"]; !exists {
		data["settings"] = copyMap(defaultSettings)
	}
	return data, nil
}

func (s *store) updateRuntime(change func(M) (any, error)) (any, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := s.readRuntimeUnlocked()
	if err != nil {
		return nil, err
	}
	result, err := change(data)
	if err != nil {
		return nil, err
	}
	if err := s.writeRuntimeUnlocked(data); err != nil {
		return nil, err
	}
	return result, nil
}

func (s *store) writeRuntimeUnlocked(data M) error {
	directory := filepath.Dir(s.path)
	temporary, err := os.CreateTemp(directory, ".runtime-*.json")
	if err != nil {
		return err
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	encoder := json.NewEncoder(temporary)
	encoder.SetIndent("", "    ")
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(data); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryName, s.path)
}

func sliceMaps(value any) []M {
	switch items := value.(type) {
	case []M:
		return items
	case []any:
		result := make([]M, 0, len(items))
		for _, item := range items {
			if record, ok := item.(map[string]any); ok {
				result = append(result, M(record))
			}
		}
		return result
	default:
		return []M{}
	}
}

func normalizeSettings(settings M) M {
	result := copyMap(defaultSettings)
	for key, value := range settings {
		result[key] = value
	}
	blocks := sliceMaps(result["schedule_blocks"])
	if len(blocks) != 5 {
		result["schedule_blocks"] = defaultBlocks
	} else {
		result["schedule_blocks"] = blocks
	}
	for _, key := range []string{"intro_video_enabled", "intro_video_loop", "animations_enabled", "scoreboard_live", "announcement_enabled", "schedule_visible", "participants_visible", "reviews_enabled"} {
		result[key] = boolValue(result[key])
	}
	result["video_darkness"] = intValue(result["video_darkness"])
	return result
}

func (s *store) bootstrap(ctx context.Context) (M, error) {
	teams, err := s.teams(ctx)
	if err != nil {
		return nil, err
	}
	schedule, err := s.schedule(ctx)
	if err != nil {
		return nil, err
	}
	participants, err := s.participants(ctx, "")
	if err != nil {
		return nil, err
	}
	settings, err := s.settings(ctx)
	if err != nil {
		return nil, err
	}
	return M{"teams": teams, "schedule": schedule, "participants": participants, "settings": settings}, nil
}

// bootstrapPage uses the local runtime snapshot so HTML and critical assets can
// be sent immediately. React refreshes live records through the API afterward.
func (s *store) bootstrapPage(_ context.Context, page string) (M, error) {
	runtime, err := s.readRuntime()
	if err != nil {
		return nil, err
	}
	result := M{
		"teams": []M{}, "schedule": []M{}, "participants": []M{}, "students": []M{},
		"settings": normalizeSettings(mapValue(runtime["settings"])),
	}
	switch page {
	case "scoreboard":
		teams := sliceMaps(runtime["teams"])
		profiles := mapValue(runtime["team_profiles"])
		for _, team := range teams {
			team["profile_image"] = stringValue(profiles[strconvString(intValue(team["id"]))])
		}
		sort.SliceStable(teams, func(i, j int) bool { return floatValue(teams[i]["score"]) > floatValue(teams[j]["score"]) })
		result["teams"] = teams
	case "schedule":
		schedule := sliceMaps(runtime["schedule"])
		sort.SliceStable(schedule, func(i, j int) bool {
			return stringValue(schedule[i]["start_time"]) < stringValue(schedule[j]["start_time"])
		})
		result["schedule"] = schedule
	case "participants":
		result["participants"] = sliceMaps(runtime["participants"])
		result["students"] = publicStudentRecords(sliceMaps(runtime["students"]))
	}
	return result, nil
}

func (s *store) teams(ctx context.Context) ([]M, error) {
	runtime, err := s.readRuntime()
	if err != nil {
		return nil, err
	}
	teams := sliceMaps(runtime["teams"])
	if s.db != nil {
		if records, queryErr := queryMaps(ctx, s.db, "SELECT id,slug,name,score,color FROM teams ORDER BY score DESC"); queryErr == nil && len(records) > 0 {
			teams = records
		}
	}
	profiles := mapValue(runtime["team_profiles"])
	for _, team := range teams {
		id := strconvString(intValue(team["id"]))
		if profile := stringValue(profiles[id]); profile != "" {
			team["profile_image"] = profile
		} else if _, exists := team["profile_image"]; !exists {
			team["profile_image"] = ""
		}
	}
	sort.SliceStable(teams, func(i, j int) bool { return floatValue(teams[i]["score"]) > floatValue(teams[j]["score"]) })
	return teams, nil
}

func (s *store) schedule(ctx context.Context) ([]M, error) {
	runtime, err := s.readRuntime()
	if err != nil {
		return nil, err
	}
	records := sliceMaps(runtime["schedule"])
	if s.db != nil {
		if queried, queryErr := queryMaps(ctx, s.db, "SELECT id,to_char(start_time,'HH24:MI') AS start_time,title,category,session,duration_minutes,status,venue FROM programs ORDER BY start_time"); queryErr == nil && len(queried) > 0 {
			records = queried
		}
	}
	sort.SliceStable(records, func(i, j int) bool {
		return stringValue(records[i]["start_time"]) < stringValue(records[j]["start_time"])
	})
	return records, nil
}

func (s *store) participants(ctx context.Context, query string) ([]M, error) {
	runtime, err := s.readRuntime()
	if err != nil {
		return nil, err
	}
	records := sliceMaps(runtime["participants"])
	if s.db != nil {
		queried, queryErr := queryMaps(ctx, s.db, `SELECT p.id,p.name,p.code,p.team_id,p.program_id,t.name AS team_name,t.slug AS team_slug,to_char(p.reporting_time,'HH24:MI') AS reporting_time,pr.title AS program,p.category,COALESCE(r.score,0) AS score FROM participants p JOIN teams t ON t.id=p.team_id LEFT JOIN programs pr ON pr.id=p.program_id LEFT JOIN results r ON r.participant_id=p.id WHERE ($1='' OR p.name ILIKE $2 OR p.code ILIKE $2) ORDER BY p.reporting_time,p.name`, query, "%"+query+"%")
		if queryErr == nil {
			records = queried
		}
	} else if query != "" {
		needle := strings.ToLower(query)
		filtered := make([]M, 0)
		for _, record := range records {
			if strings.Contains(strings.ToLower(stringValue(record["name"])+" "+stringValue(record["code"])), needle) {
				filtered = append(filtered, record)
			}
		}
		records = filtered
	}
	return records, nil
}

func (s *store) settings(ctx context.Context) (M, error) {
	runtime, err := s.readRuntime()
	if err != nil {
		return nil, err
	}
	settings := normalizeSettings(mapValue(runtime["settings"]))
	if s.db != nil {
		record, queryErr := queryOne(ctx, s.db, "SELECT festival_name,festival_date::text,intro_video_enabled,intro_video_url,intro_video_loop,video_darkness,animations_enabled,scoreboard_live,schedule_blocks FROM site_settings WHERE id=1")
		if queryErr == nil {
			if raw, ok := record["schedule_blocks"].([]byte); ok {
				var blocks any
				if json.Unmarshal(raw, &blocks) == nil {
					record["schedule_blocks"] = blocks
				}
			}
			for key, value := range record {
				settings[key] = value
			}
			settings = normalizeSettings(settings)
		}
	}
	return settings, nil
}

func (s *store) students(ctx context.Context) ([]M, error) {
	runtime, err := s.readRuntime()
	if err != nil {
		return nil, err
	}
	fallback := sliceMaps(runtime["students"])
	if s.db == nil {
		return fallback, nil
	}
	records, queryErr := queryMaps(ctx, s.db, "SELECT id,source_id,full_name,display_name,name_arabic,place,admission_no,class_id,maddhab_id,phone,email,dob::text,guardian_name,guardian_phone,status,chess_number FROM college_students ORDER BY class_id NULLS LAST,full_name")
	if queryErr != nil || len(records) == 0 {
		return fallback, nil
	}
	return records, nil
}

func (s *store) publicStudents(ctx context.Context) ([]M, error) {
	students, err := s.students(ctx)
	if err != nil {
		return nil, err
	}
	return publicStudentRecords(students), nil
}

func publicStudentRecords(students []M) []M {
	public := make([]M, 0, len(students))
	for _, student := range students {
		public = append(public, M{
			"id": student["id"], "full_name": student["full_name"], "display_name": student["display_name"],
			"name_arabic": student["name_arabic"], "place": student["place"], "class_id": student["class_id"],
			"status": student["status"], "chess_number": student["chess_number"],
		})
	}
	return public
}

func (s *store) reviews(ctx context.Context) ([]M, error) {
	runtime, err := s.readRuntime()
	if err != nil {
		return nil, err
	}
	records := sliceMaps(runtime["reviews"])
	if s.db != nil {
		if queried, queryErr := queryMaps(ctx, s.db, "SELECT id,name,rating,message,created_at FROM reviews ORDER BY created_at DESC"); queryErr == nil {
			records = queried
		}
	} else {
		sort.SliceStable(records, func(i, j int) bool {
			return stringValue(records[i]["created_at"]) > stringValue(records[j]["created_at"])
		})
	}
	return records, nil
}

func (s *store) visitorLogs(ctx context.Context) ([]M, error) {
	runtime, err := s.readRuntime()
	if err != nil {
		return nil, err
	}
	records := sliceMaps(runtime["visitor_logs"])
	if s.db != nil {
		if queried, queryErr := queryMaps(ctx, s.db, "SELECT id,name,created_at FROM visitor_logs ORDER BY created_at DESC"); queryErr == nil {
			records = queried
		}
	} else {
		sort.SliceStable(records, func(i, j int) bool {
			return stringValue(records[i]["created_at"]) > stringValue(records[j]["created_at"])
		})
	}
	return records, nil
}

func (s *store) results(ctx context.Context) ([]M, error) {
	if s.db != nil {
		return queryMaps(ctx, s.db, "SELECT r.id,p.name AS participant,p.code,pr.title AS program,p.category,t.name AS team_name,t.slug AS team_slug,r.score,r.position FROM results r JOIN participants p ON p.id=r.participant_id JOIN teams t ON t.id=p.team_id JOIN programs pr ON pr.id=r.program_id WHERE r.is_published=true ORDER BY r.published_at DESC NULLS LAST,r.score DESC")
	}
	participants, err := s.participants(ctx, "")
	if err != nil {
		return nil, err
	}
	result := make([]M, 0, len(participants))
	for index, person := range participants {
		result = append(result, M{"id": person["id"], "participant": person["name"], "code": person["code"], "program": person["program"], "category": person["category"], "team_name": person["team_name"], "team_slug": person["team_slug"], "score": person["score"], "position": index + 1})
	}
	return result, nil
}

type queryer interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

func queryMaps(ctx context.Context, connection queryer, sql string, arguments ...any) ([]M, error) {
	rows, err := connection.Query(ctx, sql, arguments...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	fields := rows.FieldDescriptions()
	records := make([]M, 0)
	for rows.Next() {
		values, valueErr := rows.Values()
		if valueErr != nil {
			return nil, valueErr
		}
		record := make(M, len(values))
		for index, value := range values {
			if timestamp, ok := value.(time.Time); ok {
				value = timestamp.UTC().Format(time.RFC3339)
			}
			record[string(fields[index].Name)] = value
		}
		records = append(records, record)
	}
	return records, rows.Err()
}

func queryOne(ctx context.Context, connection queryer, sql string, arguments ...any) (M, error) {
	records, err := queryMaps(ctx, connection, sql, arguments...)
	if err != nil {
		return nil, err
	}
	if len(records) == 0 {
		return nil, pgx.ErrNoRows
	}
	return records[0], nil
}

func (s *store) databaseHasStudents(ctx context.Context) bool {
	if s.db == nil {
		return false
	}
	var name *string
	if err := s.db.QueryRow(ctx, "SELECT to_regclass('public.college_students')::text").Scan(&name); err != nil {
		return false
	}
	return name != nil && *name != ""
}

func strconvString(value int) string { return fmt.Sprintf("%d", value) }

var errNotFound = errors.New("not found")
