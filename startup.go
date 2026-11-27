package main

import (
	"context"
	"strings"

	corev1 "k8s.io/api/core/v1"
	"sigs.k8s.io/controller-runtime/pkg/client"

	"github.com/tiny-systems/tiny/pkg/fleet"
)

// startingPrefix marks OpenTerminal's "not yet" answer: the helper is
// still starting and the window should try again, showing the rest of the
// message as the step it's on.
const startingPrefix = "starting: "

// startStage says, in words, how far a helper's pod has got, and whether
// its agent container runs yet (only then can a terminal attach). node is
// the machine the pod landed on, when known: an image it doesn't hold yet
// is being downloaded.
func startStage(p *corev1.Pod, node *corev1.Node) (stage string, ready bool) {
	if p == nil {
		return "setting up", false
	}
	for _, c := range p.Status.Conditions {
		if c.Type == corev1.PodScheduled && c.Status != corev1.ConditionTrue {
			if c.Reason == corev1.PodReasonUnschedulable && c.Message != "" {
				return "waiting for room on the garden: " + c.Message, false
			}
			return "waiting for a machine", false
		}
	}
	if p.Spec.NodeName == "" {
		return "waiting for a machine", false
	}
	held := map[string]bool{}
	if node != nil {
		for _, img := range node.Status.Images {
			for _, n := range img.Names {
				held[n] = true
			}
		}
	}
	images := map[string]string{}
	for _, c := range append(append([]corev1.Container{}, p.Spec.InitContainers...), p.Spec.Containers...) {
		images[c.Name] = c.Image
	}
	step := func(cs corev1.ContainerStatus) (string, bool) {
		switch {
		case cs.State.Running != nil:
			return "", false
		case cs.State.Terminated != nil:
			return "", false
		}
		img := cs.Image
		if img == "" {
			img = images[cs.Name]
		}
		if node != nil && img != "" && !held[img] {
			return "downloading " + shortImage(img) + " (the first helper on a garden waits for this)", true
		}
		return "", true
	}
	for _, cs := range p.Status.InitContainerStatuses {
		if cs.State.Running != nil {
			return "preparing the workspace", false
		}
		if s, waiting := step(cs); waiting {
			if s == "" {
				s = "preparing the workspace"
			}
			return s, false
		}
	}
	for _, cs := range p.Status.ContainerStatuses {
		if cs.Name != "agent" {
			continue
		}
		if cs.State.Running != nil {
			return "", true
		}
		if s, waiting := step(cs); waiting && s != "" {
			return s, false
		}
	}
	return "starting", false
}

// shortImage drops the registry: ghcr.io/tiny-systems/agent:0.18.0 reads
// as agent:0.18.0.
func shortImage(img string) string {
	if i := strings.LastIndex(img, "/"); i >= 0 {
		return img[i+1:]
	}
	return img
}

// podStage looks the pod (and its machine) up and names the step.
func podStage(ctx context.Context, c *fleet.Client, pod string) (string, bool) {
	if pod == "" {
		return startStage(nil, nil)
	}
	p := &corev1.Pod{}
	if err := c.Kube.Client.Get(ctx, client.ObjectKey{Namespace: c.Kube.Namespace, Name: pod}, p); err != nil {
		return "starting", false
	}
	var node *corev1.Node
	if p.Spec.NodeName != "" {
		n := &corev1.Node{}
		if c.Kube.Client.Get(ctx, client.ObjectKey{Name: p.Spec.NodeName}, n) == nil {
			node = n
		}
	}
	return startStage(p, node)
}
