package main

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

type M = map[string]any

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "Usage: go run ./cmd/importer /path/to/phpmyadmin-dump.sql")
		os.Exit(1)
	}
	sourcePath := os.Args[1]
	content, err := os.ReadFile(sourcePath)
	if err != nil {
		log.Fatalf("Could not read file: %v", err)
	}

	re := regexp.MustCompile(`(?s)INSERT INTO ` + "`" + `students` + "`" + ` .*? VALUES\r?\n(.*?);`)
	match := re.FindSubmatch(content)
	if match == nil {
		log.Fatal("No students INSERT statement was found.")
	}

	payload := strings.TrimSpace(string(match[1]))
	payload = strings.TrimPrefix(payload, "(")
	payload = strings.TrimSuffix(payload, ")")
	rows := regexp.MustCompile(`\),\r?\n\(`).Split(payload, -1)

	var students []M
	for _, row := range rows {
		reader := csv.NewReader(strings.NewReader(row))
		reader.Comma = ','
		reader.LazyQuotes = true
		columns, err := reader.Read()
		if err != nil || len(columns) != 17 {
			continue
		}
		for i, col := range columns {
			col = strings.TrimSpace(col)
			if strings.EqualFold(col, "NULL") {
				columns[i] = ""
			} else if strings.HasPrefix(col, "'") && strings.HasSuffix(col, "'") && len(col) >= 2 {
				col = col[1 : len(col)-1]
				col = strings.ReplaceAll(col, `\'`, `'`)
				col = strings.ReplaceAll(col, `\\`, `\`)
				columns[i] = col
			}
		}

		sourceID, _ := strconv.Atoi(columns[0])
		var classID, maddhabID any
		if columns[7] != "" {
			if cid, err := strconv.Atoi(columns[7]); err == nil {
				classID = cid
			}
		}
		if columns[8] != "" {
			if mid, err := strconv.Atoi(columns[8]); err == nil {
				maddhabID = mid
			}
		}
		status := columns[14]
		if status == "" {
			status = "active"
		}
		chessNumber := fmt.Sprintf("KZ-%03d", sourceID)

		students = append(students, M{
			"id":             sourceID,
			"source_id":      sourceID,
			"full_name":      strings.TrimSpace(columns[2]),
			"display_name":   strings.TrimSpace(columns[3]),
			"name_arabic":    strings.TrimSpace(columns[4]),
			"place":          strings.TrimSpace(columns[5]),
			"admission_no":   strings.TrimSpace(columns[6]),
			"class_id":       classID,
			"maddhab_id":     maddhabID,
			"phone":          strings.TrimSpace(columns[9]),
			"email":          strings.TrimSpace(columns[10]),
			"dob":            columns[11],
			"guardian_name":  strings.TrimSpace(columns[12]),
			"guardian_phone": strings.TrimSpace(columns[13]),
			"status":         status,
			"chess_number":   chessNumber,
		})
	}

	root, _ := os.Getwd()
	runtimePath := filepath.Join(root, "database", "runtime-data.json")
	runtimeBytes, err := os.ReadFile(runtimePath)
	if err != nil {
		log.Fatalf("Could not read runtime-data.json: %v", err)
	}

	var runtime map[string]any
	if err := json.Unmarshal(runtimeBytes, &runtime); err != nil {
		log.Fatalf("runtime-data.json is invalid: %v", err)
	}
	runtime["students"] = students

	updatedBytes, err := json.MarshalIndent(runtime, "", "  ")
	if err != nil {
		log.Fatalf("Could not serialize JSON: %v", err)
	}
	_ = os.WriteFile(runtimePath, append(updatedBytes, '\n'), 0644)

	var values []string
	for _, s := range students {
		quote := func(v any) string {
			if v == nil || v == "" {
				return "NULL"
			}
			return "'" + strings.ReplaceAll(fmt.Sprint(v), "'", "''") + "'"
		}
		valStr := fmt.Sprintf("(%v,%s,%s,%s,%s,%s,%v,%v,%s,%s,%s,%s,%s,%s,%s)",
			s["source_id"], quote(s["full_name"]), quote(s["display_name"]), quote(s["name_arabic"]),
			quote(s["place"]), quote(s["admission_no"]),
			func() string {
				if s["class_id"] == nil {
					return "NULL"
				}
				return fmt.Sprint(s["class_id"])
			}(),
			func() string {
				if s["maddhab_id"] == nil {
					return "NULL"
				}
				return fmt.Sprint(s["maddhab_id"])
			}(),
			quote(s["phone"]), quote(s["email"]), quote(s["dob"]),
			quote(s["guardian_name"]), quote(s["guardian_phone"]),
			quote(s["status"]), quote(s["chess_number"]),
		)
		values = append(values, valStr)
	}

	seed := "begin;\n\nINSERT INTO public.college_students (source_id,full_name,display_name,name_arabic,place,admission_no,class_id,maddhab_id,phone,email,dob,guardian_name,guardian_phone,status,chess_number) VALUES\n"
	seed += strings.Join(values, ",\n")
	seed += "\nON CONFLICT (source_id) DO UPDATE SET full_name=excluded.full_name,display_name=excluded.display_name,name_arabic=excluded.name_arabic,place=excluded.place,admission_no=excluded.admission_no,class_id=excluded.class_id,maddhab_id=excluded.maddhab_id,phone=excluded.phone,email=excluded.email,dob=excluded.dob,guardian_name=excluded.guardian_name,guardian_phone=excluded.guardian_phone,status=excluded.status,chess_number=excluded.chess_number,updated_at=now();\n\ncommit;\n"

	seedPath := filepath.Join(root, "database", "seed-college-students.sql")
	_ = os.WriteFile(seedPath, []byte(seed), 0644)

	fmt.Printf("Imported %d students.\n", len(students))
}
