package main

import (
	"strings"
	"testing"

	corev1 "k8s.io/api/core/v1"
)

func TestStartStageNamesEachStep(t *testing.T) {
	const img = "ghcr.io/tiny-systems/agent:0.18.0"
	unscheduled := &corev1.Pod{Status: corev1.PodStatus{Conditions: []corev1.PodCondition{{Type: corev1.PodScheduled, Status: corev1.ConditionFalse}}}}
	pulling := &corev1.Pod{
		Spec: corev1.PodSpec{NodeName: "n1",
			InitContainers: []corev1.Container{{Name: "inject-agent", Image: img}},
			Containers:     []corev1.Container{{Name: "agent", Image: img}}},
		Status: corev1.PodStatus{InitContainerStatuses: []corev1.ContainerStatus{{Name: "inject-agent",
			State: corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{Reason: "PodInitializing"}}}}},
	}
	running := &corev1.Pod{Spec: corev1.PodSpec{NodeName: "n1"}, Status: corev1.PodStatus{ContainerStatuses: []corev1.ContainerStatus{
		{Name: "agent", State: corev1.ContainerState{Running: &corev1.ContainerStateRunning{}}}}}}
	empty := &corev1.Node{}
	holds := &corev1.Node{Status: corev1.NodeStatus{Images: []corev1.ContainerImage{{Names: []string{img}}}}}

	for _, c := range []struct {
		name  string
		pod   *corev1.Pod
		node  *corev1.Node
		want  string
		ready bool
	}{
		{"no pod", nil, nil, "setting up", false},
		{"unscheduled", unscheduled, nil, "waiting for a machine", false},
		{"pulling", pulling, empty, "downloading agent:0.18.0", false},
		{"image held", pulling, holds, "preparing the workspace", false},
		{"running", running, holds, "", true},
	} {
		got, ready := startStage(c.pod, c.node)
		if ready != c.ready || !strings.HasPrefix(got, c.want) {
			t.Errorf("%s: startStage = %q, %v; want %q…, %v", c.name, got, ready, c.want, c.ready)
		}
	}
}
